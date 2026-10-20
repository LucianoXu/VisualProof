// The canvas: every node as a point, the active ones as cards. Shapes are drawn with WebGL
// (gl/renderer.ts), text on a 2D overlay, cards are DOM elements laid over both. Positions come
// from the scene graph (scene.ts): local to each cluster, summed into world positions.
//
// The reader's visitors (ViewSpec decision 27; web/src/visitors.ts, web/src/visits.ts) —
// declarations the board does not hold, gone to from here — are shown in their own places in the
// cluster hierarchy: in the board's cluster, or in temporary clusters (dashed, named in italics) the
// scene holds room for. Their edges are bundled through those clusters as any edge is; the points and
// the names are drawn on the 2D overlay. The layout, its memory and the pins never see them, and the
// folds the reader's selected visitor opens are the reader's alone.

import type { FileStatus } from "../../shared/build.ts";
import type { ClusterMode, Layout } from "../../shared/graph.ts";
import { SITE_BODY, SITE_STMT } from "../../shared/graph.ts";
import { rgba } from "./gl/gl.ts";
import type { RGBA } from "./gl/gl.ts";
import { BUNDLE_STRIDE, FLAG_DASHED, FLAG_GLOW, FLAG_HALO, FLAG_RADIAL, FLAG_SHADED, Renderer, UNIT_DOT, UNIT_WORLD, bundle, bundlePath, circle, segment } from "./gl/renderer.ts";
import { joinChains, pathOf } from "./bundles.ts";
import { EdgeQueue } from "./edgequeue.ts";
import type { EdgeWorker } from "./edgequeue.ts";
import { DIM, OVERVIEW_CROWD, aim, blendPoints, ease, weightGap, zoomPoint } from "./overview.ts";
import type { Weighted, Weights } from "./overview.ts";
import { MODE_SITES } from "../../shared/viewgraph.ts";
import type { Graph, Mode } from "../../shared/viewgraph.ts";
import { escapeHtml } from "./highlight.ts";
import { ART_DISPLAY, ART_SANS, ART_SERIF, spacedWidth, writeNames } from "./halo.ts";
import type { Written } from "./halo.ts";
import type { NameRow } from "./artwork.ts";
import { artNameId } from "../../shared/collab.ts";
import type { ArtStyle } from "../../shared/collab.ts";
import { dragKeyHeld, dragMoves, menuClick } from "./drag.ts";
import { Motion } from "./motion.ts";
import { onThemeChange, reducedMotion } from "./theme.ts";
import { clusterTroubles, ST_APPROVED, ST_COMMENTED, ST_TRUSTED, ST_UNREVIEWED, STATUSES } from "./status.ts";
import type { Scheme } from "./status.ts";
import { LEAF_R, Scene } from "./scene.ts";
import { AXIOM_AT, AXIOM_OUT, AXIOM_W, kindDot, LIT, outside, pickRadius, ringed } from "./axiomring.ts";
import type { PinState } from "./scene.ts";
import { markWords, PAST_CHANGED, PAST_GHOST, PAST_RENAMED } from "./past.ts";
import { clearOfBoxes } from "./visitors.ts";
import type { VisitPlace, VisitPlan } from "./visitors.ts";
import { openFor, placeVisits, planOn, visitChain, visitWorld } from "./visits.ts";
import type { Visits, VisitWorld } from "./visits.ts";
import { fitFrame } from "../../shared/ring.ts";
import { spotBetween } from "../../shared/doc/order.ts";
import type { Disc } from "../../shared/doc/order.ts";
import { ZOOM_LEAST, ZOOM_MOST } from "../../shared/sticky.ts";
import type { FitBox } from "../../shared/ring.ts";

export const KINDS = [
  "def", "abbrev", "structure", "class", "inductive", "instance", "theorem", "opaque", "axiom", "notation",
] as const;

/** Something the board orders (shared/doc/order.ts): a declaration or a cluster, by its index; or a
 *  note's icon, where the board draws it at rest. */
/** A declaration or a circle to pin at a spot of the board at rest (canvas.pinAtSpots). */
export interface PinMove {
  a: { kind: "node" | "cluster"; k: number; move?: number };
  spot: [number, number];
}

export type OrderBody = { kind: "node" | "cluster"; k: number } | { kind: "spot"; x: number; y: number };

/** The board drawn as an artwork (ExportSpec decision 19, the owner's decisions of 2026-10-14 and
 *  2026-10-15): what the picture holds of what the board draws besides the colouring, the theme and
 *  the edges on or off, which are the board's own. Names: as the board writes them, a lit
 *  declaration's where the board would give it a card (an artwork has none); the clusters' (and the
 *  targets'); none; or by selection: As shown, or none (`namesFrom`), without the names `hidden` and
 *  with the names `shown` (each by what it names: shared/collab.ts, artNameId), wherever they fall.
 *  Edges: all, or only the selection's, or none. Targets: their stars
 *  and names marked, or nothing of them, or of those chosen only (`shownTargets`, by full name). Keys:
 *  the key declarations' diamonds, or none; with the targets chosen, those of the targets chosen.
 *  While it is set, nothing of the reader's own is drawn over the picture: no cards, no hover, no
 *  visitors, no one else's initials. */
export interface ArtLook {
  labels: "board" | "clusters" | "none" | "chosen";
  namesFrom: "board" | "none";
  hidden: ReadonlySet<string>;
  shown: ReadonlySet<string>;
  /** names a recipe's rule chose: written after those shown, only where they cover no other name */
  ruled: ReadonlySet<string>;
  edges: "all" | "selection" | "none";
  targets: "marked" | "plain" | "highlight" | "chosen";
  shownTargets: ReadonlySet<string>;
  keys: boolean;
  /** as the board; as cells; as a starfield (artStyle) */
  style: ArtStyle;
}

/** the cells' territories' hues, a top-level namespace's each by its size, the outside world's apart */
const CELL_HUES = ["#62a8ff", "#7fe0a6", "#ffc46b", "#ff7d92", "#62dada", "#b994ff", "#f0a982", "#cbdc66"];
const CELL_OUTSIDE = "#8a93a6";
/** the starfield's lines: its constellations' figures and its clusters' bounds */
const STAR_LINE = "rgba(175, 198, 255, 1)";

/** How an artwork writes its names, by its style (ExportSpec decision 19, the owner's decisions of
 *  2026-10-15): a cluster's along the top of its circle where it fits, a top-level one in spaced
 *  capitals of Jost — the title's face, in every style — the others in italics; in Source Sans 3,
 *  or the starfield's in Source Serif 4. */
function artText(style: ArtStyle, th: { label: string; text: string }) {
  const serif = style === "stars";
  const fam = serif ? ART_SERIF : ART_SANS;
  return {
    /** the halo's colour: the theme's ground, or the style's (artwork.ts, drawBackdrop) */
    halo: style === "cells" ? "#0f1520" : style === "stars" ? "#090d1a" : null,
    clusterFill: style === "board" ? th.label : style === "cells" ? "rgba(226, 232, 246, 0.85)" : "rgba(238, 228, 200, 0.88)",
    declFill: style === "board" ? th.text : style === "cells" ? "rgba(205, 214, 232, 0.8)" : "rgba(206, 216, 236, 0.76)",
    top: (size: number) => `${serif ? 400 : 500} ${size}px ${ART_DISPLAY}`,
    sub: (size: number) => `italic 400 ${size}px ${fam}`,
    decl: serif ? `italic 400 11.5px ${ART_SERIF}` : `400 11px ${ART_SANS}`,
    target: serif ? `italic 600 12px ${ART_SERIF}` : `600 11px ${ART_SANS}`,
    spacing: (top: boolean, size: number) => size * (top ? 0.2 : 0.03),
  };
}

/** What the board's renderer draws, as an artwork's SVG writes it (ExportSpec decision 19), in the
 *  screen's pixels and in the renderer's order: a circle or a point (its fill, and a ring of `ring`
 *  pixels at radius `ringR`, dashed or not), a segment, a bundled edge (its control points, the
 *  spline's straightening `beta`, its colours from the end that uses to the end used). Colours are
 *  the renderer's, 0 to 1. */
export type ArtShape =
  | { kind: "circle"; x: number; y: number; r: number; fill: RGBA; stroke: RGBA | null; ring: number; ringR: number; dashed: boolean; look?: "glow" | "radial"; halo?: true }
  | { kind: "line"; x0: number; y0: number; x1: number; y1: number; colour: RGBA; width: number }
  | { kind: "bundle"; ctrl: number[]; beta: number; width: number; c0: RGBA; c1: RGBA };

/** What the pointer is on: one declaration, one cluster (open or folded), or a visitor (by its index
 *  in the trail, setVisitors). */
export type Target = { kind: "node"; i: number } | { kind: "cluster"; c: number } | { kind: "visitor"; k: number };

/** A visitor as the canvas draws it (ViewSpec decision 27): its name and the label beside it, what
 *  its cluster path is read from (its file, whether it is of the outside world), its place where it
 *  has one (web/src/visitors.ts, VisitPlace), what colours it in either scheme, its marks, and its
 *  edges — to nodes of the board (`board`) and to other visitors (`visitors`, by index), each [the
 *  other end, whether that end uses the visitor, whether the reference is in a statement or body]. */
export interface VisitorPoint {
  name: string;
  label: string;
  module: string;
  ext: boolean;
  place: VisitPlace | null;
  /** a declaration's kind (KINDS), or "external" */
  kind: string;
  /** an axiom, of the project or outside it: ringed (web/src/axiomring.ts) */
  axiom?: boolean;
  /** its state in the Status scheme, or the Mine scheme while it is on (web/src/status.ts) */
  status: number;
  target: boolean;
  key: boolean;
  board: [number, boolean, boolean][];
  visitors: [number, boolean, boolean][];
}

/** Where a ring of the selection is drawn, on the screen: round a point or a circle, or round a
 *  folded cluster's card (`c`). */
type Mark = { x: number; y: number; r: number } | { box: [number, number, number, number]; c: number };

/** A cluster can be pointed at when its circle is at least this large on screen; declarations
 *  when they are at least NODE_MIN_PX apart. Below that the enclosing cluster is the target. */
const CLUSTER_MIN_PX = 20;
const NODE_MIN_PX = 6;
/** a press becomes a drag only after this much movement, so a click never moves anything */
const DRAG_PX = 6;
/** a second click on a cluster within this long, and as near as a drag starts, is a double-click */
const DOUBLE_MS = 450;
/** how long a finger held still on the board opens the menu there, ms */
const HOLD_MS = 500;

export interface CanvasEvents {
  nodeClick(i: number, shift: boolean): void;
  /** a click on a visitor (setVisitors), by its index */
  visitorClick?(k: number, shift: boolean): void;
  /** a click on a cluster (its circle, or a folded one's card); a double-click folds or opens it,
   *  and the click before it has already been told */
  clusterClick(c: number, shift: boolean): void;
  backgroundClick(): void;
  hover(t: Target | null, clientX: number, clientY: number): void;
  pinsChanged(): void;
  foldChanged(): void;
  /** a right click: the menu, on what is under the pointer (null: the empty canvas), at a point of
   *  the window and of the board's world (ViewSpec, "The canvas's menu") */
  menu?(t: Target | null, clientX: number, clientY: number, world: [number, number]): void;
  /** what lies over the canvas (the panels, the bars, the buttons), in client coordinates: no
   *  card is placed under it */
  covers?(): DOMRect[];
  /** a drag that would have moved something panned instead, the board being a preview (setFrozen):
   *  the page says why */
  frozenDrag?(): void;
}

/** The board's colours, as the theme on show gives them (themeOf). */
export interface Theme {
  bg: RGBA;
  disc: RGBA;
  discLine: RGBA;
  /** for text on the label overlay */
  label: string;
  text: string;
  pin: RGBA;
  /** the two ends of an edge: the declaration that uses, and the one it uses */
  edgeFrom: RGBA;
  edgeTo: RGBA;
  /** how much fainter edges are drawn as more of them are drawn at once, beyond what every theme
   *  does (crowdFade): `--edge-crowd`, 0 for nothing more */
  edgeCrowd: number;
  kind: Record<string, RGBA>;
  ext: RGBA;
  lit: RGBA;
  /** the Status scheme's colours, indexed by state code (web/src/status.ts) */
  status: RGBA[];
  /** a target's star, and its outline */
  star: string;
  starEdge: string;
  /** a key declaration's diamond (ExportSpec decision 4) */
  key: string;
  /** the lead from the selection to the panel */
  accent: string;
  /** a past graph's marks (HistorySpec decision 17): gone now, changed since, renamed since */
  tmGone: RGBA;
  tmChanged: RGBA;
  tmRenamed: RGBA;
}

function readTheme(): Theme {
  const cs = getComputedStyle(document.body);
  return themeOf((name) => cs.getPropertyValue(name).trim());
}

/** The board's colours from the page's custom properties as `v` reads them: the browser's (the theme
 *  on show), or the style sheet's read without one (the artwork command, ExportSpec decision 21:
 *  web/src/artwork.ts, cssTheme). */
export function themeOf(v: (name: string) => string): Theme {
  const kind: Record<string, RGBA> = {};
  for (const k of KINDS) kind[k] = rgba(v(`--k-${k}`));
  return {
    bg: rgba(v("--canvas")),
    disc: rgba(v("--disc")),
    discLine: rgba(v("--disc-line")),
    label: v("--label"),
    text: v("--text-2"),
    pin: rgba(v("--label")),
    edgeFrom: rgba(v("--edge-from")),
    edgeTo: rgba(v("--edge-to")),
    edgeCrowd: Math.max(0, parseFloat(v("--edge-crowd")) || 0),
    kind,
    ext: rgba(v("--k-external")),
    lit: rgba(v("--accent")),
    status: STATUSES.map((st) => rgba(v(`--status-${st}`))),
    star: v("--target-star"),
    starEdge: v("--target-star-edge"),
    key: v("--key-mark"),
    accent: v("--accent"),
    tmGone: rgba(v("--tm-gone")),
    tmChanged: rgba(v("--tm-changed")),
    tmRenamed: rgba(v("--tm-renamed")),
  };
}

/** Whether two things the pointer can be on are the same one. */
function sameTarget(a: Target, b: Target): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "node") return a.i === (b as typeof a).i;
  if (a.kind === "cluster") return a.c === (b as typeof a).c;
  return a.k === (b as typeof a).k;
}

/** How much fainter each of `n` edges drawn at once is, beyond what every theme does, where more than
 *  `from` are: (from / n)^crowd, the theme's `crowd` (Theme.edgeCrowd; 1 for a crowd of 0). Edges
 *  that cross add up towards the colour of their mix, at full opacity once enough of them do: on the
 *  light ground a dense bundle reads as ink, on the dark one as light — the orange and the blue of
 *  hundreds of edges a pink-white haze. The dark theme has them step back as they grow many. */
export function crowdFade(n: number, from: number, crowd: number): number {
  return crowd > 0 && n > from ? (from / n) ** crowd : 1;
}

/** A colour at `k` of its opacity. */
const fade = (c: RGBA, k: number): RGBA => [c[0], c[1], c[2], c[3] * k];

/** How many lit declarations the board gives a card at zoom `k`: a card's name is what an artwork
 *  writes in its place (it has no cards). */
const cardCap = (k: number) => (k < 0.12 ? 0 : k < 0.35 ? 40 : k < 0.8 ? 90 : CARD_CAP);

export const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", sans-serif`;
const CELL = 24;
const CARD_CAP = 180;
/** position ids kept past the scene's for the visitors and their temporary clusters, whose edges are
 *  bundled through them (web/src/visits.ts, visitChain) */
const VISIT_SLOTS = 256;

/** A press, until it is let go. On a target with the layout locked, `pan` holds where the camera
 *  was: a drag pans, a click still selects and a double-click still folds. */
type Gesture =
  | { kind: "pan"; x: number; y: number; cx: number; cy: number; moved: boolean }
  | { kind: "node"; x: number; y: number; i: number; dx: number; dy: number; moved: boolean; pan?: { cx: number; cy: number }; refused?: boolean }
  | { kind: "cluster"; x: number; y: number; c: number; dx: number; dy: number; moved: boolean; pan?: { cx: number; cy: number }; refused?: boolean }
  /** on a visitor, which nothing moves: a drag pans, a click selects it */
  | { kind: "visitor"; x: number; y: number; k: number; moved: boolean; pan: { cx: number; cy: number }; refused?: boolean };

/** A late zoom point is caught up at up to this many times the zoom's own pace: the drawn blend moves
 *  by at most CATCH_UP · |Δz| of weight in a frame where the camera zoomed by Δz zoom points. */
const CATCH_UP = 2;
/** The camera's zoom has come to rest once it has not changed for this long, ms: what is drawn is
 *  then settled to the camera's own blend, there being no zoom left to ease along. */
const ZOOM_REST = 60;
/** A fast zoom is asked for where it will be by the time the answer comes, at most this many frames
 *  ahead. */
const LEAD = 6;

/** A board drawn without a browser (the artwork command, ExportSpec decision 21): a screen of `w` ×
 *  `h` pixels, the theme's colours, and the context the names are written to (one that measures as
 *  the fonts the package ships do: web/src/artwork.ts SvgContext). */
export interface Headless {
  w: number;
  h: number;
  theme: Theme;
  ctx: CanvasRenderingContext2D;
}

export class GraphCanvas {
  private canvas: HTMLCanvasElement;
  gl: Renderer;
  private labels: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cardsEl: HTMLElement;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private theme: Theme;
  g: Graph;
  private ev: CanvasEvents;

  layout!: Layout;
  scene!: Scene;
  cam = { x: 0, y: 0, k: 1 };
  /** where the camera animation in progress ends */
  private camGoal: { x: number; y: number; k: number } | null = null;
  /** screen space covered by panels; fitting and flying aim at the area between them */
  insets = { left: 0, right: 0, top: 0, bottom: 0 };

  /** whose edges a selection draws (selection.ts, edgeMode) */
  mode: Mode = "tcb";
  /** the declarations the selection's picks start from (setActivation): ringed, never a card */
  focus: number[] = [];
  active: Uint8Array | null = null;
  private activeList: number[] = [];
  /** active nodes inside each cluster, at any depth */
  private clusterActive = new Int32Array(0);
  private edges: number[] = [];
  /** under the Keys step of Rests on, the key graph's edges among what is lit, as pairs (from, to)
   *  of nodes, drawn dashed in place of the references among it (setActivation); null otherwise */
  private keyEdges: number[] | null = null;
  showExternals = true;

  private grid = new Map<number, number[]>();
  private cards = new Map<string, HTMLElement>();
  /** the layout is locked (the reader's, setLocked; the default since 2026-10-09): a drag pans the
   *  view, never moves a thing */
  private locked = true;
  /** which of the places beside its declaration each card took last (SIDES), by card key */
  private cardSide = new Map<string, number>();
  /** the leads from lit declarations to their cards, this frame: x0, y0, x1, y1, node */
  private leaders: number[] = [];
  /** where the cards of folded clusters are this frame, by cluster: a selected one's ring goes
   *  round its card */
  private clusterBoxes = new Map<number, [number, number, number, number]>();
  /** the clusters selected (setActivation): ringed, as the declarations selected are */
  private picked: number[] = [];
  /** what the panel tells of — a declaration or a cluster — drawn with a lead to the panel instead
   *  of a card (setLead) */
  private lead: Target | null = null;
  private leadEnd: () => { x: number; y: number } | null = () => null;
  /** where the lead ended in the last frame: a lead whose end moves is drawn again */
  private leadWas: { x: number; y: number } | null = null;
  /** measured card size */
  private cardSize = new Map<HTMLElement, [number, number]>();
  private dirty = true;
  /** the instance buffers need rebuilding: content changed, not just the camera */
  private sceneDirty = true;
  private anim: number | null = null;
  private repSeen = -1;
  /** each cluster's own build trouble (status.ts, clusterTroubles), -1 for none: its outline in the
   *  Status scheme */
  private clusterTrouble = new Int8Array(0);
  private files = new Map<string, FileStatus>();
  /** how the layout on show clusters: a file's own build trouble outlines its cluster only when
   *  clusters are files (a namespace may share a module's name without being that file) */
  private clustering: ClusterMode = "namespace";
  /** how the points are coloured (setScheme): by kind, or by where each stands (CanvasSpec,
   *  "Colour schemes", decided 2026-10-08) */
  scheme: Scheme = "kind";
  /** per node, its state in the Status scheme — in the Mine scheme, its Mine state — (web/src/status.ts),
   *  from setStatus */
  private statusCode: Uint8Array = new Uint8Array(0);
  /** per cluster, of what it holds that needs review: how many are approved, commented, and in
   *  all (the Status scheme's progress arcs) */
  private clusterProgress = new Int32Array(0);
  /** the highlighted target: what a click or a drag acts on */
  hoverTarget: Target | null = null;
  /** where the pointer is over the canvas (null when it is elsewhere), and whether it is down */
  private pointer: { sx: number; sy: number; x: number; y: number } | null = null;
  private pressing = false;
  /** declaration names' widths at the label font, measured once per graph */
  private nameW = new Float32Array(0);
  /** the review's targets, marked with a gold star (ReviewSpec) */
  private targetList: number[] = [];
  /** key declarations, marked with a small diamond (ExportSpec decision 4) */
  private keyList: number[] = [];
  /** of each of them, the targets it is key for (setKeys): an artwork's targets chosen keep their
   *  own keys' diamonds */
  private keyOf: readonly (readonly number[])[] = [];
  /** what other readers have selected (CollabSpec "On the canvas"): per node, their colours and
   *  initials */
  private peerMarks = new Map<number, { colors: string[]; labels: string[] }>();
  /** a past graph's marks per node (web/src/past.ts, PAST_*), and the names now of those renamed
   *  since; null on the graph of now */
  private pastMarks: Uint8Array | null = null;
  private nowNames = new Map<number, string>();
  /** a preview of a view at another build than its own (web/src/views.ts): a drag pans, whatever the
   *  lock */
  private frozen = false;
  /** the ring is the panel's preview, not the pointer's */
  private previewing = false;
  /** the camera the highlight was last picked under */
  private hoverCam = { x: 0, y: 0, k: 1 };
  /** edges with nothing selected: on by default; statements' and bodies', never proofs' (CanvasSpec
   *  "Edges") */
  showEdges = true;
  /** the artwork's look while its mode is on (ExportSpec decision 19): the board is the picture */
  art: ArtLook | null = null;
  /** the cells' hues of the layout's clusters (hueOf), and the use of the declaration used most
   *  (mostUsed) */
  private hues: { layout: Layout; of: RGBA[] } | null = null;
  private used: { g: Graph; most: number } | null = null;
  /** of its names shown by selection, the clusters' keys and the declarations' full names */
  private artClusters = new Set<string>();
  private artDecls: string[] = [];
  /** the names a recipe's rule chose (ExportSpec decision 20): clusters by key, declarations */
  private artRuled = new Set<string>();
  private artRuledDecls: string[] = [];
  /** what the names the last frame wrote name (artNameId), on an artwork: what its list of names
   *  shows ticked */
  private namesWritten = new Set<string>();
  /** where the names and marks are drawn other than on the screen (an artwork's file): the transform
   *  from the screen's CSS pixels to that context's */
  private labelBase: [number, number, number, number, number, number] | null = null;
  /** smoothed time between animation frames, ms; and the last draw's cost */
  frameMs = 16;
  drawMs = 0;
  /** world positions of clusters then nodes, for the bundled edges */
  private posData = new Float32Array(0);
  private posDirty = true;
  /** what the overview's points are valid for: the scene, what is shut, and the toggles */
  private overviewBase = "";
  /** the scene on show, counted: a new one names other clusters, and what was drawn of the old goes */
  private sceneSerial = 0;
  /** the graph whose edges the overview's chooser holds */
  private overviewGraph: Graph | null = null;
  /** the overview's zoom points (a quarter of a step apart: what is chosen there, from the two steps
   *  blended as the point lies between them), chosen off the page's thread where a worker can be had
   *  (web/src/edgequeue.ts, web/src/edgeworker.ts; the owner's request, 2026-10-10) */
  private edgeQ: EdgeQueue;
  /** what the overview draws: weights of zoom points. The camera between two points draws both,
   *  blended by where it is — so that zooming changes what is drawn as it goes, never at an instant —
   *  and while a point it needs is late, what is at hand, caught up with the zoom when it comes
   *  (drawOverview). Null until a base's first points come */
  private drawnW: Weights | null = null;
  /** the camera's zoom point at the last frame; when its zoom last changed, which way and by how
   *  much */
  private overviewZ = NaN;
  private zoomAt = 0;
  private zoomDir = 0;
  private zoomLast = 0;
  private restTimer: ReturnType<typeof setTimeout> | null = null;
  /** when the points were last chosen again for a view that moved, and the wait before the next */
  private overviewAt = 0;
  private overviewTimer: ReturnType<typeof setTimeout> | null = null;
  /** what the points' looks were made for (the selection, the mode), counted as it changes (and at
   *  every rebuild of the scene's instances), and what was last drawn of them */
  private overviewStyled = "";
  private overviewStyle = 0;
  private overviewDrawn = "";
  /** counts the themes the board has been drawn in (setTheme): the overview's drawing is of one */
  private themeSerial = 0;
  /** the reader's visitors (setVisitors), and those of them selected (ringed as a selected point is) */
  private visitors: VisitorPoint[] = [];
  private visitorSel: number[] = [];
  /** the board's hidden levels the visitors were placed under, where they are placed, and where that
   *  is drawn this frame */
  private visitHidden: readonly string[] = [];
  private visits: Visits | null = null;
  private visitW: VisitWorld | null = null;
  /** the board's clusters round the selected visitors' places, and those of them folded on the board
   *  that are open on this page for the reader (ViewSpec decision 27): the board's folds are the
   *  scene's and these */
  private openAround = new Set<number>();
  private tempOpen = new Set<number>();

  /** drawn without a browser: no graphics card, no input, no frames but those asked for (`settle`) */
  private readonly headless: boolean;

  /** A board on the page's canvas; or, with `host` (and nulls for the elements), the same board drawn
   *  without a browser — its renderer kept to its data, which an artwork's SVG reads (ExportSpec
   *  decision 21). */
  constructor(canvas: HTMLCanvasElement | null, labels: HTMLCanvasElement | null, cardsEl: HTMLElement | null, g: Graph, ev: CanvasEvents, host?: Headless) {
    this.headless = !!host;
    this.canvas = canvas as HTMLCanvasElement;
    this.gl = new Renderer(host ? null : canvas);
    this.labels = labels as HTMLCanvasElement;
    this.ctx = host ? host.ctx : labels!.getContext("2d")!;
    // layers draw in this order
    // (an artwork's: the starfield's figures under the edges, a glow under the points)
    for (const [name, kind] of [["discs", "circles"], ["figures", "lines"], ["overview", "bundles"], ["selection", "bundles"], ["glow", "points"], ["dots", "points"],
      ["rings", "points"], ["bubbles", "circles"], ["active", "points"], ["hoverC", "circles"], ["hoverP", "points"]] as const)
      this.gl.layer(name, kind);
    this.cardsEl = cardsEl as HTMLElement;
    this.g = g;
    this.ev = ev;
    this.edgeQ = new EdgeQueue(
      () => (host || typeof Worker === "undefined" ? null : (new Worker("/edges.js", { type: "module" }) as unknown as EdgeWorker)),
      () => this.request(),
    );
    if (host) {
      // a screen of its own, at one pixel each; the edges chosen at once (EdgeQueue, no worker)
      this.theme = host.theme;
      [this.w, this.h, this.dpr] = [host.w, host.h, 1];
      return;
    }
    this.theme = readTheme();
    // light or dark changed (the reader's choice, the system's, an artwork's look): the colours are
    // read again
    onThemeChange(() => this.setTheme(readTheme()));
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    this.resize();
    this.bindInput();
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(64, t - last);
      this.frameMs = this.frameMs * 0.9 + (t - last) * 0.1;
      last = t;
      if (this.scene?.moving) {
        this.scene.step(dt);
        this.afterMotion();
      }
      if (this.dirty) {
        this.dirty = false;
        // the view moved under a resting pointer (fit, a flight to a search hit): what it points
        // at changed with it
        const c = this.cam;
        if (this.pointer && (c.x !== this.hoverCam.x || c.y !== this.hoverCam.y || c.k !== this.hoverCam.k)) this.refreshHover();
        this.hoverCam = { ...c };
        this.draw();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  request(): void {
    this.dirty = true;
  }

  /** The board's colours are `th` now (the theme on show changed): everything is drawn again in them,
   *  the overview's edges too, whose drawing is otherwise kept while what it shows is the same. */
  setTheme(th: Theme): void {
    this.theme = th;
    this.themeSerial++;
    this.invalidate();
  }

  /** Without a browser (ExportSpec decision 21): draw until nothing more comes — the scene at rest,
   *  the overview's points chosen and blended, nothing asking for another frame — at most `most`
   *  frames; whether it came to rest. */
  settle(most = 60): boolean {
    for (let n = 0; n < most; n++) {
      if (this.scene?.moving) {
        this.scene.step(64);
        this.afterMotion();
      }
      this.dirty = false;
      this.draw();
      if (!this.dirty && !this.scene?.moving) return true;
    }
    return false;
  }

  /** Called after every frame drawn: what lies over the canvas and follows it (the notes,
   *  web/src/sticky.ts) is placed again. */
  onFrame: (() => void) | null = null;
  /** the clusters' names as the last frame wrote them, each box in the world (left, top, right,
   *  bottom, four numbers a box) */
  private labelBoxes: number[] = [];
  /** of those, where each open cluster's own name is (its first number's index) */
  private labelOfC = new Map<number, number>();
  /** what Fit to screen frames besides the board, at a zoom: the notes' icons, and with `cards` the
   *  cards of the notes that show expanded there, each its box on the screen (web/src/sticky.ts,
   *  fitBoxes) */
  fitExtra: ((k: number, cards: boolean) => FitBox[]) | null = null;

  /** The canvas element: what is laid over it sends it the wheel. */
  /** Whether the pointer is down on the board (a drag, a pan): no moment to reload in (web/src/reload.ts). */
  get pressed(): boolean {
    return this.pressing;
  }

  get element(): HTMLCanvasElement {
    return this.canvas;
  }

  /** Content changed (not just the camera): rebuild the GPU instances before the next frame. */
  invalidate(): void {
    this.sceneDirty = true;
    this.dirty = true;
  }

  // ------------------------------------------------------------------ positions, via the scene

  /** The layout as the board draws it: each cluster and declaration at its place in its parent as
   *  the scene has it (its pin, or where pins and folds pushed it), not where the layout put it.
   *  Only the local places are the drawing's; the world ones are left as they were. What made way
   *  for the reader's visitors, and the folds opened for one, are not the board's (ViewSpec decision
   *  27): then the board's own arrangement is taken from its pins and folds, as a reload has it. */
  drawnLayout(): Layout {
    const L = this.layout;
    let s = this.scene;
    if (s.holds() || this.tempOpen.size) {
      s = new Scene(L);
      s.restore(this.scene.pins((i) => this.pinName(i)), this.foldedKeys(), (i) => this.pinName(i));
    }
    return { ...L, lx: Array.from(s.ancNX), ly: Array.from(s.ancNY), clusters: L.clusters.map((c, k) => ({ ...c, lx: s.ancCX[k], ly: s.ancCY[k] })) };
  }

  get px(): Float32Array {
    return this.scene.nwx;
  }

  get py(): Float32Array {
    return this.scene.nwy;
  }

  /** The board's folds: the scene's, and those open on this page for the reader's selected visitor
   *  (ViewSpec decision 27), which are folded on the board all the same. */
  get folded(): Set<number> {
    return this.tempOpen.size ? new Set([...this.scene.folded, ...this.tempOpen]) : this.scene.folded;
  }

  get nodeRep(): Int32Array {
    return this.scene.nodeRep;
  }

  isPinned(i: number): boolean {
    return this.scene.isPinned(i);
  }

  /** After the scene moved: redraw; when what is shut changed, what is drawn changed too. */
  private afterMotion(): void {
    this.posDirty = true;
    if (this.scene.repVersion !== this.repSeen) {
      this.repSeen = this.scene.repVersion;
      this.recomputeEdges();
      this.clearCards();
    }
    if (!this.scene.moving) {
      this.rebuildGrid();
      // what came to rest under a still pointer is what it now points at
      this.refreshHover();
    }
    this.invalidate();
  }

  // ------------------------------------------------------------------ graph, build, layout

  /** A new graph for the same project: everything indexed by node starts over. setLayout
   *  follows. */
  setGraph(g: Graph): void {
    this.g = g;
    this.statusCode = new Uint8Array(g.n).fill(ST_UNREVIEWED);
    this.nameW = new Float32Array(0);
    this.focus = [];
    this.picked = [];
    this.active = null;
    this.activeList = [];
    this.edges = [];
    this.keyEdges = null;
    // a past graph's marks are set again for the graph they are of
    this.pastMarks = null;
    this.nowNames = new Map();
    // a visitor's edges were of the graph before: the page gives them again (setVisitors)
    this.visitors = this.visitors.map((v) => ({ ...v, board: [], visitors: [] }));
    this.clearCards();
  }

  setBuild(files: FileStatus[] | null): void {
    this.files = new Map((files ?? []).map((f) => [f.module, f]));
    this.recomputeStates();
    this.clearCards();
    this.invalidate();
  }

  /** Which nodes are the review's targets: each carries a gold star. */
  setTargets(targets: number[]): void {
    this.targetList = targets;
    this.clearCards();
    this.invalidate();
  }

  /** Which nodes are key declarations: each carries a small diamond beside its point. `of`: the
   *  targets each is key for, in the same order. */
  setKeys(keys: number[], of: readonly (readonly number[])[] = []): void {
    const same = (a: readonly number[], b: readonly number[] | undefined) => !!b && a.length === b.length && a.every((k, j) => k === b[j]);
    if (same(keys, this.keyList) && of.length === this.keyOf.length && of.every((ts, j) => same(ts, this.keyOf[j]))) return;
    this.keyList = keys;
    this.keyOf = of;
    this.clearCards();
    this.invalidate();
  }

  isKey(i: number): boolean {
    return this.keyList.includes(i);
  }

  /** Where each node of the canvas's graph stands (web/src/status.ts, statusCodes; mineCodes in the
   *  Mine scheme): its colour in the Status or the Mine scheme, and the clusters' progress. */
  setStatus(codes: Uint8Array): void {
    this.statusCode = codes.length === this.g.n ? codes : new Uint8Array(this.g.n).fill(ST_UNREVIEWED);
    this.countProgress();
    if (this.scheme !== "kind") this.clearCards();
    this.invalidate();
  }

  /** Colour the points by kind, by status or by the reader's own review (Mine, in Status's colours,
   *  from the codes setStatus was given). Rings, the target's star and the others' marks are the same
   *  in each. */
  setScheme(s: Scheme): void {
    if (s === this.scheme) return;
    this.scheme = s;
    this.clearCards();
    this.invalidate();
  }

  /** A node's state in the Status scheme (an index into STATUSES). */
  statusOf(i: number): number {
    return this.statusCode[i] ?? ST_UNREVIEWED;
  }

  /** What is on the board, counted for the legend: per state of the Status scheme (STATUSES) and
   *  per kind (KINDS, then the outside world). The outside world counts only while it is shown. */
  counts(): { status: number[]; kinds: number[] } {
    const status = new Array<number>(STATUSES.length).fill(0);
    const kinds = new Array<number>(KINDS.length + 1).fill(0);
    const g = this.g;
    for (let i = 0; i < g.n; i++) {
      const ext = g.isExt(i);
      if (ext && !this.showExternals) continue;
      status[this.statusCode[i] ?? ST_UNREVIEWED]++;
      const k = ext ? KINDS.length : KINDS.indexOf(g.nodes[i].kind as (typeof KINDS)[number]);
      kinds[k < 0 ? KINDS.length : k]++;
    }
    return { status, kinds };
  }

  /** Each cluster's progress, for its arc in the Status scheme: of what it holds that needs review
   *  (what is not trusted), how many are approved and how many commented. */
  private countProgress(): void {
    if (!this.layout) return;
    const L = this.layout;
    const P = (this.clusterProgress = new Int32Array(3 * L.clusters.length));
    for (let i = 0; i < this.g.n; i++) {
      const st = this.statusCode[i];
      if (st === ST_TRUSTED || (this.g.isExt(i) && !this.showExternals)) continue;
      const k = st === ST_APPROVED ? 0 : st === ST_COMMENTED ? 1 : -1;
      for (let c = L.cluster[i]; c >= 0; c = L.clusters[c].parent) {
        if (k >= 0) P[3 * c + k]++;
        P[3 * c + 2]++;
      }
    }
  }

  /** A past graph's marks (HistorySpec decision 17), in this graph's numbering: a ghost of what is
   *  gone now, a ring round what changed or was renamed since; the name now on a renamed one's card.
   *  Null on the graph of now. */
  setPast(marks: Uint8Array | null, now: Map<number, string> = new Map()): void {
    this.pastMarks = marks && marks.length === this.g.n ? marks : null;
    this.nowNames = now;
    this.clearCards();
    this.invalidate();
  }

  /** A declaration's marks against now, or 0. */
  pastMarkOf(i: number): number {
    return this.pastMarks?.[i] ?? 0;
  }

  /** The name now of a declaration renamed since, on a past graph. */
  nowNameOf(i: number): string | undefined {
    return this.nowNames.get(i);
  }

  /** A preview, which nothing arranges: a drag pans, as on a locked layout, even with the drag key
   *  held. */
  setFrozen(on: boolean): void {
    this.frozen = on;
  }

  /** Other readers' selections: a ring in each one's colour, their initials beside it. */
  setPeers(marks: { i: number; color: string; label: string }[]): void {
    this.peerMarks.clear();
    for (const m of marks) {
      const e = this.peerMarks.get(m.i) ?? { colors: [], labels: [] };
      e.colors.push(m.color);
      e.labels.push(m.label);
      this.peerMarks.set(m.i, e);
    }
    this.request();
  }

  isTarget(i: number): boolean {
    return this.targetList.includes(i);
  }

  fileOf(i: number): FileStatus | undefined {
    return this.g.isExt(i) ? undefined : this.files.get(this.g.nodes[i].module);
  }

  private recomputeStates(): void {
    if (!this.layout) return;
    // in the file layout a cluster is a module (or a directory of them); under namespaces none has
    // an outline of its own
    this.clusterTrouble = clusterTroubles(this.layout.clusters, this.clustering, this.files);
  }

  setLayout(layout: Layout, places: PinState, foldedKeys: string[], clustering: ClusterMode): void {
    this.layout = layout;
    this.clustering = clustering;
    this.scene = new Scene(layout);
    this.labelBoxes = [];
    // the visitors on the new layout (ViewSpec decision 27): the folds round a selected one stay open
    // and their room is held, at once
    const plan = this.visitors.length ? planOn(layout, clustering, this.visitHidden, this.g, this.visitors) : null;
    this.openAround = plan ? openFor(plan, this.scene.parent, this.visitorSel) : new Set();
    const byKey = new Map(layout.clusters.map((c, i) => [c.key, i]));
    this.tempOpen = new Set(foldedKeys.map((k) => byKey.get(k) ?? -1).filter((c) => this.openAround.has(c)));
    this.scene.restore(places, foldedKeys.filter((k) => !this.tempOpen.has(byKey.get(k) ?? -1)), (i) => this.pinName(i));
    const motion = new Motion(this.scene, this.g);
    motion.near = (wx, wy, r) => this.nodesNear(wx, wy, r);
    this.scene.motion = motion;
    // a new layout (a mode switch, a live update): nothing is under the pointer any more
    if (this.ev) this.setHover(null, 0, 0);
    this.posData = new Float32Array(2 * (this.scene.nc + this.scene.n + VISIT_SLOTS));
    this.posDirty = true;
    this.sceneSerial++;
    this.visits = null;
    if (plan) this.placeOn(plan, true);
    this.repSeen = this.scene.repVersion;
    this.countActive();
    this.recomputeStates();
    this.countProgress();
    this.rebuildGrid();
    this.recomputeEdges();
    this.clearCards();
    this.invalidate();
  }

  pinsRecord(): PinState {
    return this.scene.pins((i) => this.pinName(i));
  }

  /** Pins as the workspace now has them (another reader dropped or let go of something). */
  applyPins(pins: PinState): void {
    if (this.scene.applyPins(pins, (i) => this.pinName(i))) this.request();
  }

  /** The name a declaration's pin is kept under: its name, or on a past graph its name now where a
   *  rename since gave it one — a view's pins speak the names of now, as a move keeps them
   *  (HistorySpec decision 8), so that a pin dropped at a past build is the same pin at the latest. */
  pinName(i: number): string {
    return this.nowNames.get(i) ?? this.g.nodes[i].name;
  }

  unpin(i: number): void {
    this.scene.unpinNode(i);
    this.request();
  }

  foldedKeys(): string[] {
    return [...this.folded].map((c) => this.layout.clusters[c].key);
  }

  /** Folds as the board now has them (another reader folded or opened something, ViewSpec
   *  decision 2): applied without foldChanged, which tells the others of this reader's own. True
   *  when anything changed. */
  setFoldedKeys(keys: string[]): boolean {
    const byKey = new Map(this.layout.clusters.map((c, i) => [c.key, i]));
    const next = new Set<number>();
    for (const k of keys) {
      const c = byKey.get(k);
      if (c !== undefined) next.add(c);
    }
    const now = this.folded;
    if (next.size === now.size && [...next].every((c) => now.has(c))) return false;
    this.foldScene(next);
    return true;
  }

  /** Fold the scene as the board's folds `B` say, but for those open for the reader's selected
   *  visitor (ViewSpec decision 27): open on this page alone, folded on the board all the same. */
  private foldScene(B: Set<number>): void {
    this.tempOpen = new Set([...B].filter((c) => this.openAround.has(c)));
    const next = new Set([...B].filter((c) => !this.tempOpen.has(c)));
    const now = this.scene.folded;
    if (next.size === now.size && [...next].every((c) => now.has(c))) return;
    this.scene.setFolded(next);
    this.afterMotion();
  }

  /** Where a declaration (by name) or a cluster (by key) is on the screen now — a declaration in a
   *  folded cluster where that cluster is; null when the board does not hold it. */
  screenOf(kind: "node" | "cluster", key: string): [number, number] | null {
    if (kind === "cluster") {
      const c = this.layout.clusters.findIndex((x) => x.key === key);
      return c < 0 ? null : this.toScreen(this.scene.cwx[c], this.scene.cwy[c]);
    }
    const i = this.g.byName.get(key);
    return i === undefined ? null : this.toScreen(...this.posOf(i));
  }

  /** Where cluster `key`'s circle is drawn on the screen: its centre and radius. */
  clusterDisc(key: string): [number, number, number] | null {
    const c = this.layout.clusters.findIndex((x) => x.key === key);
    if (c < 0) return null;
    const [sx, sy] = this.toScreen(this.scene.cwx[c], this.scene.cwy[c]);
    return [sx, sy, this.scene.drawnR[c] * this.cam.k];
  }

  /** A declaration's colour in the scheme on show, as CSS. */
  colourOf(i: number): string {
    const [r, g, b, a] = this.colorOf(i);
    return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
  }

  /** Where the board draws everything at rest, nothing folded — its layout and its pins, as the
   *  server reads it for the document (server/boardspots.ts) — in the board's world. */
  atRest(): { nx: Float32Array; ny: Float32Array; cx: Float32Array; cy: Float32Array; r: Float32Array } {
    const S = new Scene(this.layout);
    S.restore(this.pinsRecord(), [], (i) => this.pinName(i));
    return { nx: S.nwx, ny: S.nwy, cx: S.cwx, cy: S.cwy, r: S.drawnR };
  }

  /** Where `a` goes between `prev` and `next` in the board's order — `prev` read before it, so
   *  lower on the board; `next` after, higher (shared/doc/order.ts) — as the board draws things at
   *  rest: at a height between theirs, where it is across; on their row, between them, where they
   *  are level; below the first, above the last. All three are of one cluster, `parent` (-1: none).
   *  Null where neither is given. */
  orderSpot(a: OrderBody, prev: OrderBody | null, next: OrderBody | null, R = this.atRest()): [number, number] | null {
    const disc = (b: OrderBody): Disc => (b.kind === "spot" ? { x: b.x, y: b.y, r: LEAF_R } : b.kind === "node" ? { x: R.nx[b.k], y: R.ny[b.k], r: LEAF_R } : { x: R.cx[b.k], y: R.cy[b.k], r: R.r[b.k] });
    return spotBetween(disc(a), prev && disc(prev), next && disc(next));
  }

  /** Pin declaration or circle `a` between `prev` and `next` in the board's order (orderSpot), as a
   *  drop there would, for everyone on the board. A section of the document standing for a chain of
   *  circles is read where its innermost is (`a.k`) and moved by its outermost (`move`), which
   *  carries the rest. False where nothing moved. */
  pinInOrder(a: { kind: "node" | "cluster"; k: number; move?: number }, prev: OrderBody | null, next: OrderBody | null): boolean {
    const R = this.atRest();
    const spot = this.orderSpot(a, prev, next, R);
    if (!spot) return false;
    return this.pinAtSpots([{ a, spot }], R);
  }

  /** Pin each declaration or circle at a spot of the board at rest (`R`, read before any of them
   *  moved), as a drop there would, for everyone on the board, in one change: the linear form
   *  reorders a run of siblings so (ExportSpec decision 18). A circle is read where `k` is and
   *  moved by `move`, as in pinInOrder. */
  pinAtSpots(moves: PinMove[], R = this.atRest()): boolean {
    for (const p of this.localPins(moves, R)) this.scene.pinAt(p.kind, p.m, p.lx, p.ly);
    if (!moves.length) return false;
    this.posDirty = true;
    this.ev.pinsChanged();
    this.request();
    return true;
  }

  /** Each move as a pin: what is moved, and where, in its parent's coordinates (which nothing folded
   *  scales at rest). */
  private localPins(moves: PinMove[], R: ReturnType<GraphCanvas["atRest"]>): { kind: "node" | "cluster"; m: number; lx: number; ly: number }[] {
    return moves.map(({ a, spot }) => {
      const m = a.kind === "cluster" ? (a.move ?? a.k) : a.k;
      const [ax, ay] = a.kind === "node" ? [R.nx[a.k], R.ny[a.k]] : [R.cx[a.k], R.cy[a.k]];
      const [mx, my] = a.kind === "node" ? [ax, ay] : [R.cx[m], R.cy[m]];
      const p = a.kind === "node" ? this.scene.nodeCluster[m] : this.scene.parent[m];
      const [ox, oy] = p >= 0 ? [R.cx[p], R.cy[p]] : [0, 0];
      return { kind: a.kind, m, lx: mx + spot[0] - ax - ox, ly: my + spot[1] - ay - oy };
    });
  }

  /** Where the board would draw everything at rest were `moves` pinned too, the latest drops, as
   *  the server would read it (atRest): what the linear form checks a reorder by before making
   *  it — a drop is brought inside its parent and the rest make way, which can undo an order.
   *  Nothing is pinned. */
  atRestWith(moves: PinMove[], R = this.atRest()): ReturnType<GraphCanvas["atRest"]> {
    const was = this.pinsRecord();
    const pins: PinState = { nodes: { ...was.nodes }, clusters: { ...was.clusters } };
    for (const p of this.localPins(moves, R)) {
      const bag = p.kind === "cluster" ? pins.clusters : pins.nodes;
      const key = p.kind === "cluster" ? this.layout.clusters[p.m].key : this.pinName(p.m);
      // the latest drop: last in the record
      delete bag[key];
      bag[key] = [p.lx, p.ly];
    }
    const S = new Scene(this.layout);
    S.restore(pins, [], (i) => this.pinName(i));
    return { nx: S.nwx, ny: S.nwy, cx: S.cwx, cy: S.cwy, r: S.drawnR };
  }

  /** A spot of the board at rest (atRest) where the board draws it now: moved with its cluster
   *  `key` (null: none), as folds and easing have moved that. */
  restToNow(key: string | null, spot: [number, number], R = this.atRest()): [number, number] {
    const c = key === null ? -1 : this.layout.clusters.findIndex((x) => x.key === key);
    if (c < 0) return spot;
    return [spot[0] - R.cx[c] + this.scene.cwx[c], spot[1] - R.cy[c] + this.scene.cwy[c]];
  }

  /** Folded, or inside a folded cluster: not drawn as itself. */
  isCollapsed(c: number): boolean {
    const B = this.folded;
    for (let x = c; x >= 0; x = this.scene.parent[x]) if (B.has(x)) return true;
    return false;
  }

  toggleFold(c: number): void {
    const next = new Set(this.folded);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    this.applyFolds(next);
  }

  /** The deepest cluster level of the current layout. */
  maxDepth(): number {
    return this.layout.clusters.reduce((m, c) => Math.max(m, c.depth), 0);
  }

  /** How many levels are open: the depth of the shallowest folded cluster, maxDepth() + 1 when
   *  nothing is folded. */
  openLevels(): number {
    let d = this.maxDepth() + 1;
    for (const c of this.folded) d = Math.min(d, this.layout.clusters[c].depth);
    return d;
  }

  /** One level more (+1) or less (−1) for the whole view. A step opens or folds the next level
   *  that has a cluster large enough to see at this zoom, so every step changes the picture;
   *  levels of only tiny clusters are passed over, both ways. */
  stepLevels(dir: 1 | -1): void {
    const max = this.maxDepth() + 1;
    const now = this.openLevels();
    const seen = new Uint8Array(max);
    this.layout.clusters.forEach((c) => {
      if (c.r * this.cam.k >= CLUSTER_MIN_PX) seen[c.depth] = 1;
    });
    if (dir > 0) {
      if (now >= max) return;
      // the next level that folds something large enough to see; past the last, everything opens
      let d = now + 1;
      while (d < max && !seen[d]) d++;
      this.foldAt(d >= max ? null : d);
      return;
    }
    if (now <= 0) return;
    let d = now - 1;
    while (d > 0 && !seen[d]) d--;
    this.foldAt(d);
  }

  /** Fold every cluster at `depth` (0 = top level); `null` unfolds everything. */
  foldAt(depth: number | null): void {
    const next = new Set<number>();
    if (depth !== null) this.layout.clusters.forEach((c, i) => c.depth === depth && next.add(i));
    this.applyFolds(next);
  }

  private applyFolds(next: Set<number>): void {
    this.foldScene(next);
    this.ev.foldChanged();
  }

  private visibleNode(i: number): boolean {
    if (this.scene.nodeRep[i] >= 0) return false;
    if (this.g.isExt(i)) return this.showExternals || (this.active?.[i] ?? 0) > 0;
    return true;
  }

  private rebuildGrid(): void {
    this.grid.clear();
    if (!this.scene) return;
    for (let i = 0; i < this.g.n; i++) {
      if (!this.visibleNode(i)) continue;
      const key = Math.floor(this.px[i] / CELL) * 100003 + Math.floor(this.py[i] / CELL);
      let cell = this.grid.get(key);
      if (!cell) this.grid.set(key, (cell = []));
      cell.push(i);
    }
  }

  // ------------------------------------------------------------------ visitors

  /** The reader's visitors (ViewSpec decision 27), each in its own place in the cluster hierarchy,
   *  and which of them are selected: the folded clusters round a selected one's place open for the
   *  reader alone. `hidden`: the board's hidden levels under its clustering. Returns each visitor's
   *  place — where the outermost of what it brings stands — for the trail to keep and presence to
   *  carry: the one it had, or one chosen now where it had none in the cluster it is in. */
  setVisitors(vs: VisitorPoint[], selected: number[], hidden: readonly string[]): VisitPlace[] {
    this.visitors = vs;
    this.visitorSel = selected;
    this.visitHidden = hidden;
    const h = this.hoverTarget;
    if (h?.kind === "visitor" && h.k >= vs.length) this.hoverTarget = null;
    // no board yet: the first one places them (setLayout)
    if (!this.scene) return [];
    const plan = vs.length ? planOn(this.layout, this.clustering, hidden, this.g, vs) : null;
    this.openAround = plan ? openFor(plan, this.scene.parent, selected) : new Set();
    this.foldScene(this.folded);
    if (plan) this.placeOn(plan, false);
    else {
      this.visits = null;
      this.scene.setHeld(new Map());
    }
    this.posDirty = true;
    this.invalidate();
    return this.visits?.places ?? [];
  }

  /** Place the visitors as `plan` says, on the scene as it is now, and hold their room in it; a new
   *  spot keeps clear of the clusters' names as the last frame wrote them. */
  private placeOn(plan: VisitPlan, snap: boolean): void {
    const vs = this.visitors.map((v) => ({ name: v.name, module: v.module, ext: v.ext, place: v.place, near: v.board.map(([j]) => j) }));
    this.visits = placeVisits(this.scene, this.layout, plan, vs, (x, y, r) => clearOfBoxes(this.labelBoxes, x, y, r));
    this.scene.setHeld(this.visits.held, snap);
  }

  /** Whether cluster `c`, folded on the board, is open on this page for the reader's selected
   *  visitor (ViewSpec decision 27). */
  openForVisitor(c: number): boolean {
    return this.tempOpen.has(c);
  }

  /** The folded cluster whose card hides visitor `k`, or -1. */
  visitorCard(k: number): number {
    return this.visits && k >= 0 && k < this.visits.plan.at.length ? visitWorld(this.visits, this.scene).vrep[k] : -1;
  }

  /** The board's cluster visitor `k` is placed in (its temporary clusters inside it are the reader's
   *  alone), or -1 at the top level or where there is no such visitor. */
  visitorIn(k: number): number {
    return this.visits && k >= 0 && k < this.visits.plan.at.length ? this.visits.plan.at[k].in : -1;
  }

  /** Where visitor `k` is drawn in the world: its point, or the folded cluster whose card hides it. */
  visitorPos(k: number): [number, number] | null {
    if (!this.visits || k < 0 || k >= this.visits.plan.at.length) return null;
    const W = visitWorld(this.visits, this.scene);
    const c = W.vrep[k];
    return c >= 0 ? [this.scene.cwx[c], this.scene.cwy[c]] : [W.vx[k], W.vy[k]];
  }

  /** A visitor's radius on the screen: a little larger than a lit point, never too small to hit. */
  private visitorR(): number {
    return Math.max(5, this.dotPx() * 1.5);
  }

  /** Where a folded card's visitor marker is on the screen: at the upper left of its disc (a note's
   *  marker is at the upper right). */
  private visitMarkAt(c: number): [number, number] {
    const S = this.scene;
    const r = Math.max(S.drawnR[c], 6 / this.cam.k);
    return this.toScreen(S.cwx[c] - r * 0.62, S.cwy[c] - r * 0.62);
  }

  /** The visitor under a point of the canvas, or null: a visitor's point, or the marker of a folded
   *  card that hides some, which stands for the newest of them. */
  private visitorAt(sx: number, sy: number): number | null {
    const W = this.visitW;
    if (!W) return null;
    const r = this.visitorR() + 4;
    let best: number | null = null;
    let bestD = Infinity;
    for (let k = 0; k < this.visitors.length && k < W.vx.length; k++) {
      const c = W.vrep[k];
      if (c >= 0 && !this.clusterVisible(c)) continue;
      const [x, y] = c >= 0 ? this.visitMarkAt(c) : this.toScreen(W.vx[k], W.vy[k]);
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d <= (c >= 0 ? 10 * 10 : r * r) && d <= bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  }

  /** Where open cluster `c`'s name was written in the last frame, on the screen (left, top, right,
   *  bottom), or null where it was not: a note's card keeps off its own cluster's name where it can
   *  (web/src/sticky.ts). */
  labelOf(c: number): [number, number, number, number] | null {
    const j = this.labelOfC.get(c);
    if (j === undefined) return null;
    const b = this.labelBoxes;
    const [x0, y0] = this.toScreen(b[j], b[j + 1]);
    const [x1, y1] = this.toScreen(b[j + 2], b[j + 3]);
    return [x0, y0, x1, y1];
  }

  // ------------------------------------------------------------------ activation

  /** What the panel tells of — a declaration, or a cluster — has a ring and a lead to the panel,
   *  which show where it is, so that the canvas does not say again what the panel says, nor cover
   *  what is around it. `end` is where the lead ends on the screen (the panel's edge, level with its
   *  title), null while the panel is away. */
  setLead(t: Target | null, end: () => { x: number; y: number } | null): void {
    this.lead = t;
    this.leadEnd = end;
    this.request();
  }

  /** Lock the layout or let it go: locked (the default), a drag on a declaration or a circle pans
   *  the view as a drag on empty space does; a click still selects, a double-click still folds.
   *  The drag key (⌘ on a Mac, Ctrl elsewhere) held at the press does the other (CanvasSpec, "Hover,
   *  click, drag"; web/src/drag.ts). */
  setLocked(on: boolean): void {
    this.locked = on;
  }

  /** What is lit: `closure`, the selection's set; the edges drawn are `mode`'s, or the key graph's
   *  (`keyEdges`, pairs of nodes: ViewSpec decision 20) under the Keys step of Rests on. The roots of
   *  the selection's picks — declarations (`focus`) and clusters (`clusters`) — have a ring and no
   *  card. */
  setActivation(mode: Mode, focus: number[], closure: Uint8Array | null, clusters: number[] = [], keyEdges: number[] | null = null): void {
    this.mode = mode;
    this.keyEdges = closure ? keyEdges : null;
    this.focus = focus;
    this.picked = clusters;
    this.active = closure;
    // the theme's colours are read again (an edge's colours are the theme's, the same in every mode);
    // without a browser they are the host's
    if (!this.headless)
      requestAnimationFrame(() => {
        this.theme = readTheme();
        this.invalidate();
      });
    this.activeList = [];
    if (closure) for (let i = 0; i < closure.length; i++) if (closure[i]) this.activeList.push(i);
    this.countActive();
    this.clearCards();
    this.recomputeEdges();
    this.rebuildGrid();
    this.invalidate();
  }

  /** The board's drawing of the screen's rectangle `rect` at `f` pixels for each of the screen's,
   *  its rows `y0` to `y0 + rows`, onto `out` from its top left: an artwork's PNG, a band at a time
   *  (ExportSpec decision 19). The renderer draws it a tile at a time on the board's own canvas —
   *  through `cam`, the camera the picture was framed with, its soft rims as many pixels wide as the
   *  screen's (Renderer.render, `aa`) — and the names and marks are written over it as the screen has
   *  them; the screen is drawn again after. */
  paintArtBand(out: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, f: number, y0: number, rows: number, cam: { x: number; y: number; k: number }): void {
    const was = { cam: this.cam, ctx: this.ctx, w: this.canvas.width, h: this.canvas.height };
    const W = out.canvas.width;
    const tile = Math.min(2048, this.gl.maxSide());
    this.cam = { ...cam };
    try {
      const dotR = this.dotPx();
      for (let x0 = 0; x0 < W; x0 += tile) {
        const tw = Math.min(tile, W - x0);
        if (this.canvas.width !== tw || this.canvas.height !== rows) [this.canvas.width, this.canvas.height] = [tw, rows];
        const cw = tw / f, ch = rows / f;
        const [wx, wy] = this.toWorld(rect.x + x0 / f + cw / 2, rect.y + y0 / f + ch / 2);
        this.gl.render({ x: wx, y: wy, k: cam.k }, cw, ch, f, dotR, (0.35 * this.dpr) / f);
        out.drawImage(this.canvas, 0, 0, tw, rows, x0, 0, tw, rows);
      }
      // the names and the marks, on a canvas of their own laid over it
      const lab = document.createElement("canvas");
      [lab.width, lab.height] = [W, rows];
      this.ctx = lab.getContext("2d")!;
      this.labelBase = [f, 0, 0, f, -rect.x * f, -(rect.y * f + y0)];
      this.drawLabels((sx, sy, pad) => sx > -pad && sy > -pad && sx < this.w + pad && sy < this.h + pad, dotR);
      out.drawImage(lab, 0, 0);
    } finally {
      this.cam = was.cam;
      this.ctx = was.ctx;
      this.labelBase = null;
      [this.canvas.width, this.canvas.height] = [was.w, was.h];
      this.dirty = true;
      this.draw();
    }
  }

  /** The names and marks the board writes over its renderer's drawing, written with `ctx` (an
   *  artwork's SVG, web/src/artwork.ts: it records what is drawn), in the screen's CSS pixels. */
  drawMarks(ctx: CanvasRenderingContext2D): void {
    const was = this.ctx;
    this.ctx = ctx;
    this.labelBase = [1, 0, 0, 1, 0, 0];
    try {
      this.drawLabels((sx, sy, pad) => sx > -pad && sy > -pad && sx < this.w + pad && sy < this.h + pad, this.dotPx());
    } finally {
      this.ctx = was;
      this.labelBase = null;
      this.dirty = true;
      this.request();
    }
  }

  /** What the renderer draws that reaches the screen's rectangle `rect`, as shapes in the screen's
   *  pixels, in its order: what an artwork's SVG writes as vectors (ExportSpec decision 19). */
  artShapes(rect: { x: number; y: number; w: number; h: number }): ArtShape[] {
    const { x: cx, y: cy, k } = this.cam;
    const sx = (x: number) => (x - cx) * k + this.w / 2, sy = (y: number) => (y - cy) * k + this.h / 2;
    const dot = this.dotPx();
    const meets = (x0: number, y0: number, x1: number, y1: number) => x1 >= rect.x && y1 >= rect.y && x0 <= rect.x + rect.w && y0 <= rect.y + rect.h;
    const P = this.posData;
    const out: ArtShape[] = [];
    const four = (d: Float32Array, o: number): RGBA => [d[o], d[o + 1], d[o + 2], d[o + 3]];
    for (const L of this.gl.drawn()) {
      const d = L.data;
      for (let n = 0; n < L.count; n++) {
        const o = n * L.stride;
        if (L.kind === "circles" || L.kind === "points") {
          const unit = d[o + 3];
          const r = Math.max(unit < 0.5 ? d[o + 2] * k : unit < 1.5 ? d[o + 2] : d[o + 2] * dot, d[o + 15]);
          const x = sx(d[o]), y = sy(d[o + 1]);
          const ring = d[o + 12], ringR = r + d[o + 14];
          const ext = Math.max(r, ringR + ring / 2);
          if (!meets(x - ext, y - ext, x + ext, y + ext)) continue;
          const fill = four(d, o + 4), stroke = ring > 0 && d[o + 11] > 0 ? four(d, o + 8) : null;
          if (fill[3] <= 0.002 && !stroke) continue;
          const flags = Math.round(d[o + 13]);
          out.push({
            kind: "circle", x, y, r, fill, stroke, ring, ringR, dashed: (flags & FLAG_DASHED) !== 0,
            ...(flags & FLAG_GLOW ? { look: "glow" as const } : flags & FLAG_RADIAL ? { look: "radial" as const } : {}),
            ...(flags & FLAG_HALO ? { halo: true as const } : {}),
          });
        } else if (L.kind === "lines") {
          const x0 = sx(d[o]), y0 = sy(d[o + 1]), x1 = sx(d[o + 2]), y1 = sy(d[o + 3]), w = d[o + 8];
          if (!meets(Math.min(x0, x1) - w, Math.min(y0, y1) - w, Math.max(x0, x1) + w, Math.max(y0, y1) + w)) continue;
          out.push({ kind: "line", x0, y0, x1, y1, colour: four(d, o + 4), width: w });
        } else {
          const len = Math.round(d[o + 8]);
          const ctrl: number[] = [];
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (let j = 0; j < len; j++) {
            const id = Math.round(d[o + j]);
            const x = sx(P[2 * id]), y = sy(P[2 * id + 1]);
            ctrl.push(x, y);
            [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
          }
          // a B-spline keeps within its control points: one whose box misses the frame misses it
          const w = d[o + 10];
          if (!meets(x0 - w, y0 - w, x1 + w, y1 + w)) continue;
          out.push({ kind: "bundle", ctrl, beta: d[o + 9], width: w, c0: four(d, o + 12), c1: four(d, o + 16) });
        }
      }
    }
    return out;
  }

  /** What the names the board wrote in its last frame name (shared/collab.ts, artNameId), on an
   *  artwork: those its names by selection hold now (ExportSpec decision 19). */
  writtenNames(): ReadonlySet<string> {
    return this.namesWritten;
  }

  /** The names an artwork's frame `rect` (the screen's) can hold, for its list of names (ExportSpec
   *  decision 19): the clusters' the board would write where their names fall in it, and those chosen
   *  already, in the board's order; then the declarations' whose points are in it, nearest its middle
   *  first. */
  artNames(rect: { x: number; y: number; w: number; h: number }): NameRow[] {
    const S = this.scene;
    if (!S) return [];
    const inside = (x: number, y: number) => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
    const out: NameRow[] = [];
    for (let c = 0; c < S.nc; c++) {
      const spot = this.chosenSpot(c);
      const cl = this.layout.clusters[c];
      if (!spot || !inside(spot.x, spot.y) || (!spot.board && !this.artClusters.has(cl.key) && !this.artRuled.has(cl.key))) continue;
      out.push({ id: artNameId("cluster", cl.key), label: cl.label, full: cl.key.replace("⟨external⟩", "External"), cluster: true });
    }
    const mx = rect.x + rect.w / 2, my = rect.y + rect.h / 2;
    const decls: number[] = [];
    const dist = new Map<number, number>();
    for (let i = 0; i < this.g.n; i++) {
      if (!this.visibleNode(i)) continue;
      const [sx, sy] = this.toScreen(this.px[i], this.py[i]);
      if (!inside(sx, sy)) continue;
      decls.push(i);
      dist.set(i, (sx - mx) ** 2 + (sy - my) ** 2);
    }
    decls.sort((a, b) => dist.get(a)! - dist.get(b)!);
    for (const i of decls) out.push({ id: artNameId("decl", this.g.nodes[i].name), label: this.g.short(i), full: this.g.nodes[i].name, cluster: false });
    return out;
  }

  /** Where cluster `c`'s name is written when an artwork's names are chosen: as the board writes it,
   *  under a folded cluster's disc or inside the top of an open one's circle, and above a circle too
   *  small to hold it; whether the board would write it at all (`board`: the circle large enough);
   *  null where the cluster is not drawn. */
  private chosenSpot(c: number): { x: number; y: number; size: number; font: string; board: boolean } | null {
    const S = this.scene;
    const rep = S.rep[c];
    if ((rep >= 0 && rep !== c) || !this.clusterVisible(c)) return null;
    const [sx, sy] = this.toScreen(S.cwx[c], S.cwy[c]);
    if (rep === c) {
      const r = Math.max(6, S.drawnR[c] * this.cam.k);
      return { x: sx, y: sy + r + 13, size: 11, font: `500 11px ${FONT}`, board: r > 10 };
    }
    const sr = S.drawnR[c] * this.cam.k;
    const size = Math.max(10, Math.min(20, 9 + sr / 40));
    const font = `${this.layout.clusters[c].depth === 0 ? 600 : 500} ${size}px ${FONT}`;
    return sr > 38 ? { x: sx, y: sy - sr + size + 6, size, font, board: true } : { x: sx, y: sy - sr - 4, size, font, board: false };
  }

  /** The targets an artwork chose, by their nodes. */
  private chosenTargets(): Set<number> {
    const on = new Set<number>();
    for (const n of this.art?.shownTargets ?? []) {
      const i = this.g.byName.get(n);
      if (i !== undefined) on.add(i);
    }
    return on;
  }

  /** The targets marked, their stars drawn and their names in bold: every one, but where an artwork
   *  marks none (As any) or only those it chose (By selection). */
  private markedTargets(): number[] {
    const t = this.art?.targets;
    if (t === "plain") return [];
    if (t !== "chosen") return this.targetList;
    const on = this.chosenTargets();
    return this.targetList.filter((i) => on.has(i));
  }

  /** Draw the board as an artwork (null: as ever). */
  setArt(look: ArtLook | null): void {
    this.art = look;
    this.artClusters = new Set();
    this.artDecls = [];
    this.artRuled = new Set();
    this.artRuledDecls = [];
    for (const id of look?.shown ?? []) {
      if (id.startsWith("c:")) this.artClusters.add(id.slice(2));
      else if (id.startsWith("d:")) this.artDecls.push(id.slice(2));
    }
    for (const id of look?.ruled ?? []) {
      if (id.startsWith("c:")) this.artRuled.add(id.slice(2));
      else if (id.startsWith("d:")) this.artRuledDecls.push(id.slice(2));
    }
    this.overviewBase = "";
    this.setHover(null, 0, 0);
    this.invalidate();
    this.request();
  }

  setEdges(show: boolean): void {
    this.showEdges = show;
    this.request();
  }

  setShowExternals(on: boolean): void {
    this.showExternals = on;
    this.countProgress();
    this.rebuildGrid();
    this.invalidate();
  }

  /** Whether the edge u → v (of sites `site`) is drawn lit, as the board draws it (recomputeEdges):
   *  between two lit declarations, of the sites the mode follows; none while the key graph's edges
   *  are drawn instead (keyLinks). The linear form's arcs follow it (web/src/linear.ts). */
  edgeLit(u: number, v: number, site: number): boolean {
    const act = this.active;
    return !this.keyEdges && !!act && !!act[u] && !!act[v] && (site & MODE_SITES[this.mode]) !== 0;
  }

  /** The key graph's edges drawn under the Keys step of Rests on, as pairs of nodes (the one that
   *  rests on, then the one it rests on); null where they are not drawn. */
  get keyLinks(): readonly number[] | null {
    return this.keyEdges;
  }

  /** Edges between active nodes that the mode follows, as triples (u, v, sites); none where the key
   *  graph's edges are drawn instead. */
  private recomputeEdges(): void {
    this.edges = [];
    const act = this.active;
    if (!act || !this.scene || this.keyEdges) return;
    const sites = MODE_SITES[this.mode];
    const g = this.g;
    const rep = this.scene.nodeRep;
    const seen = new Set<number>();
    for (const u of this.activeList) {
      for (let e = g.outStart[u]; e < g.outStart[u + 1]; e++) {
        const v = g.outDst[e];
        const s = g.outSite[e] & sites;
        if (!s || !act[v]) continue;
        const ru = rep[u];
        const rv = rep[v];
        if (ru >= 0 || rv >= 0) {
          if (ru >= 0 && ru === rv) continue;
          const key = (ru >= 0 ? -(ru + 1) : u) * 1_000_003 + (rv >= 0 ? -(rv + 1) : v);
          if (seen.has(key)) continue;
          seen.add(key);
        }
        this.edges.push(u, v, s);
        if (this.edges.length > 90_000) return;
      }
    }
  }

  // ------------------------------------------------------------------ camera

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    for (const c of [this.canvas, this.labels]) {
      c.width = Math.round(r.width * this.dpr);
      c.height = Math.round(r.height * this.dpr);
    }
    this.request();
  }

  /** The canvas's size and the room the panels leave around the board: where a share link's camera
   *  is read as the region it shows, and fitted (shared/sharesnap.ts). */
  get screen(): { w: number; h: number; insets: { left: number; right: number; top: number; bottom: number } } {
    return { w: this.w, h: this.h, insets: { ...this.insets } };
  }

  toScreen(x: number, y: number): [number, number] {
    return [(x - this.cam.x) * this.cam.k + this.w / 2, (y - this.cam.y) * this.cam.k + this.h / 2];
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.w / 2) / this.cam.k + this.cam.x, (sy - this.h / 2) / this.cam.k + this.cam.y];
  }

  /** Where a node is drawn: itself, or the folded cluster hiding it. */
  posOf(i: number): [number, number] {
    const r = this.scene.nodeRep[i];
    if (r >= 0) return [this.scene.cwx[r], this.scene.cwy[r]];
    return [this.px[i], this.py[i]];
  }

  private clusterVisible(c: number): boolean {
    return !this.layout.clusters[c].ext || this.showExternals || (this.active !== null && this.clusterHasActive(c));
  }

  /** Whether cluster `c` is drawn on this board: the outside world's are hidden where the board
   *  leaves it out. */
  isClusterShown(c: number): boolean {
    return this.clusterVisible(c);
  }

  /** Frame the whole board in the room the bars and panels leave: its top-level circles and
   *  declarations, the notes' icons — on the ring around it, at its top level and in its clusters —
   *  and their cards (CanvasSpec, "Notes"), which keep their size on the screen as the zoom goes;
   *  without the cards where they would not fit, and without the notes where their icons would not. */
  fit(animate = true): void {
    const S = this.scene;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of S.rootC) {
      if (!this.clusterVisible(c)) continue;
      const r = S.drawnR[c];
      x0 = Math.min(x0, S.cwx[c] - r);
      y0 = Math.min(y0, S.cwy[c] - r);
      x1 = Math.max(x1, S.cwx[c] + r);
      y1 = Math.max(y1, S.cwy[c] + r);
    }
    for (const i of S.rootN) {
      x0 = Math.min(x0, this.px[i] - 8);
      y0 = Math.min(y0, this.py[i] - 8);
      x1 = Math.max(x1, this.px[i] + 8);
      y1 = Math.max(y1, this.py[i] + 8);
    }
    if (!isFinite(x0)) return;
    const vw = this.w - this.insets.left - this.insets.right;
    const vh = this.h - this.insets.top - this.insets.bottom;
    const corners: FitBox[] = [
      { x: x0, y: y0, dx0: 0, dy0: 0, dx1: 0, dy1: 0 },
      { x: x1, y: y1, dx0: 0, dy0: 0, dx1: 0, dy1: 0 },
    ];
    const extra = this.fitExtra;
    const framed = (cards: boolean) => (extra ? fitFrame((k) => [...corners, ...extra(k, cards)], vw * 0.94, vh * 0.94, 4) : null);
    const f = framed(true) ?? framed(false);
    if (f) return this.moveTo(f.x, f.y, f.k, animate);
    const k = Math.min(vw / (x1 - x0), vh / (y1 - y0)) * 0.94;
    this.moveTo((x0 + x1) / 2, (y0 + y1) / 2, Math.min(k, 4), animate);
  }

  /** The camera that holds the whole board — its top-level circles and declarations — in the
   *  screen's rectangle `rect` (an artwork's frame, web/src/artframe.ts); null for a board with
   *  nothing on it. */
  fitCam(rect: { x: number; y: number; w: number; h: number }): { x: number; y: number; k: number } | null {
    const S = this.scene;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of S.rootC) {
      if (!this.clusterVisible(c)) continue;
      const r = S.drawnR[c];
      [x0, y0, x1, y1] = [Math.min(x0, S.cwx[c] - r), Math.min(y0, S.cwy[c] - r), Math.max(x1, S.cwx[c] + r), Math.max(y1, S.cwy[c] + r)];
    }
    for (const i of S.rootN) [x0, y0, x1, y1] = [Math.min(x0, this.px[i] - 8), Math.min(y0, this.py[i] - 8), Math.max(x1, this.px[i] + 8), Math.max(y1, this.py[i] + 8)];
    if (!isFinite(x0)) return null;
    const k = Math.min(ZOOM_MOST, Math.min(rect.w / (x1 - x0), rect.h / (y1 - y0)) * 0.94);
    // the board's middle at the rectangle's
    return { x: (x0 + x1) / 2 - (rect.x + rect.w / 2 - this.w / 2) / k, y: (y0 + y1) / 2 - (rect.y + rect.h / 2 - this.h / 2) / k, k };
  }

  /** Bring the camera to `cam` over `dur` ms, easing in and out (an artwork's frame closing in on the
   *  board, and opening out again: ExportSpec decision 19). */
  glideTo(cam: { x: number; y: number; k: number }, dur: number): void {
    this.animate(cam, dur);
  }

  /** Put the camera at `cam` at once, ending any motion in progress, which would carry it off: a
   *  share link's region, framed (shared/sharesnap.ts). */
  jumpTo(cam: { x: number; y: number; k: number }): void {
    if (this.anim) cancelAnimationFrame(this.anim);
    this.anim = this.camGoal = null;
    this.cam = { ...cam };
    this.request();
  }

  /** The camera where it is gliding to, at once (reduced motion: GuideSpec decision 4). */
  arrive(): void {
    if (this.camGoal) this.jumpTo(this.camGoal);
  }

  /** Zoom by `f` around the middle of the unobstructed area (the zoom buttons, + and -). */
  zoomBy(f: number): void {
    const cx = this.insets.left + (this.w - this.insets.left - this.insets.right) / 2;
    const cy = this.insets.top + (this.h - this.insets.top - this.insets.bottom) / 2;
    // aim from where an animation in progress is going, so that quick presses add up
    const base = this.camGoal ?? this.cam;
    const wx = base.x + (cx - this.w / 2) / base.k;
    const wy = base.y + (cy - this.h / 2) / base.k;
    this.moveTo(wx, wy, Math.min(ZOOM_MOST, Math.max(ZOOM_LEAST, base.k * f)), true, 240);
  }

  flyTo(i: number): void {
    const [x, y] = this.posOf(i);
    this.moveTo(x, y, Math.max(this.cam.k, 1.1), true);
  }

  /** Bring a point of the world to the middle, at least as near as now, and at least at zoom `least`
   *  (by default where declarations can be pointed at). */
  flyToPoint(x: number, y: number, least = 0.6): void {
    this.moveTo(x, y, Math.min(ZOOM_MOST, Math.max(this.cam.k, least)), true);
  }

  /** Bring cluster `c` to the middle, filling much of the screen; at least so near that its radius
   *  is `minPx` on the screen, where that is asked (a note in it, readable, web/src/sticky.ts). */
  flyToCluster(c: number, minPx = 0): void {
    const S = this.scene;
    const k = Math.min(4, (Math.min(this.w, this.h) * 0.42) / Math.max(S.drawnR[c], 20));
    this.moveTo(S.cwx[c], S.cwy[c], Math.min(ZOOM_MOST, Math.max(k, minPx / Math.max(S.drawnR[c], 1e-6))), true);
  }

  /** Frame the declarations `set` marks (the board's numbering) in the room the bars and panels
   *  leave, never nearer than a declaration is pointed at well: the tour's views of what a theorem
   *  rests on (GuideSpec decision 2). */
  fitTo(set: Uint8Array, animate = true): void {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < set.length; i++) {
      if (!set[i]) continue;
      const [x, y] = this.posOf(i);
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
    if (!isFinite(x0)) return;
    const vw = this.w - this.insets.left - this.insets.right;
    const vh = this.h - this.insets.top - this.insets.bottom;
    const k = Math.min(vw / (x1 - x0 + 80), vh / (y1 - y0 + 80)) * 0.9;
    this.moveTo((x0 + x1) / 2, (y0 + y1) / 2, Math.min(1.6, Math.max(ZOOM_LEAST, k)), animate);
  }

  /** Bring world point (x, y) to the middle of the unobstructed area at zoom k. */
  private moveTo(px: number, py: number, k: number, animate: boolean, dur = 520): void {
    if (this.anim) cancelAnimationFrame(this.anim);
    const cx = this.insets.left + (this.w - this.insets.left - this.insets.right) / 2;
    const cy = this.insets.top + (this.h - this.insets.top - this.insets.bottom) / 2;
    const x = px - (cx - this.w / 2) / k;
    const y = py - (cy - this.h / 2) / k;
    if (!animate) {
      this.camGoal = null;
      this.cam = { x, y, k };
      this.request();
      return;
    }
    this.animate({ x, y, k }, dur);
  }

  /** The camera carried to `goal` over `dur` ms, easing in and out; with reduced motion there at
   *  once (theme.ts, reducedMotion): a flight, a fit, the zoom buttons, an artwork's frame closing in. */
  private animate(goal: { x: number; y: number; k: number }, dur: number): void {
    if (reducedMotion()) return this.jumpTo(goal);
    if (this.anim) cancelAnimationFrame(this.anim);
    const { x, y, k } = goal;
    this.camGoal = { x, y, k };
    const from = { ...this.cam };
    const t0 = performance.now();
    const step = (t: number) => {
      const u = Math.min(1, (t - t0) / dur);
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      // zoom interpolated geometrically, so the motion feels even
      this.cam = {
        x: from.x + (x - from.x) * e,
        y: from.y + (y - from.y) * e,
        k: from.k * Math.pow(k / from.k, e),
      };
      this.request();
      if (u < 1) this.anim = requestAnimationFrame(step);
      else this.anim = this.camGoal = null;
    };
    this.anim = requestAnimationFrame(step);
  }

  // ------------------------------------------------------------------ hit testing

  nodeAt(sx: number, sy: number): number | null {
    const [wx, wy] = this.toWorld(sx, sy);
    const rad = Math.max(7, 10 / this.cam.k);
    const r2 = (Math.max(8, 4 * this.cam.k) / this.cam.k) ** 2;
    let best: number | null = null;
    let bestD = r2;
    const c0x = Math.floor((wx - rad) / CELL), c1x = Math.floor((wx + rad) / CELL);
    const c0y = Math.floor((wy - rad) / CELL), c1y = Math.floor((wy + rad) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cy = c0y; cy <= c1y; cy++) {
        const cell = this.grid.get(cx * 100003 + cy);
        if (!cell) continue;
        for (const i of cell) {
          const d = (this.px[i] - wx) ** 2 + (this.py[i] - wy) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    return best;
  }

  /** Visible nodes within r of a world point, from the hit grid. */
  private nodesNear(wx: number, wy: number, r: number): number[] {
    const out: number[] = [];
    const c0x = Math.floor((wx - r) / CELL), c1x = Math.floor((wx + r) / CELL);
    const c0y = Math.floor((wy - r) / CELL), c1y = Math.floor((wy + r) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cy = c0y; cy <= c1y; cy++) {
        for (const i of this.grid.get(cx * 100003 + cy) ?? []) {
          if ((this.px[i] - wx) ** 2 + (this.py[i] - wy) ** 2 <= r * r) out.push(i);
        }
      }
    }
    return out;
  }

  /** A folded cluster's disc under the pointer (they are drawn at least 6 px across). */
  private foldedAt(sx: number, sy: number): number | null {
    const [wx, wy] = this.toWorld(sx, sy);
    const S = this.scene;
    let best: number | null = null;
    for (const c of S.folded) {
      if (S.rep[c] !== c || !this.clusterVisible(c)) continue;
      const r = Math.max(S.drawnR[c], 6 / this.cam.k);
      if ((S.cwx[c] - wx) ** 2 + (S.cwy[c] - wy) ** 2 <= r * r) best = c;
    }
    return best;
  }

  /** The innermost open cluster containing a point, among those large enough on screen. */
  private clusterAt(sx: number, sy: number): number | null {
    const [wx, wy] = this.toWorld(sx, sy);
    const S = this.scene;
    const k = this.cam.k;
    let best: number | null = null;
    for (let c = 0; c < S.nc; c++) {
      if (S.rep[c] >= 0 || !this.clusterVisible(c)) continue;
      const r = S.drawnR[c];
      if (r * k < CLUSTER_MIN_PX) continue;
      if ((S.cwx[c] - wx) ** 2 + (S.cwy[c] - wy) ** 2 > r * r) continue;
      if (best === null || this.layout.clusters[c].depth > this.layout.clusters[best].depth) best = c;
    }
    return best;
  }

  /** The most specific thing under the pointer that can be told apart at this zoom: a
   *  declaration, a folded cluster, or the innermost open cluster large enough on screen. */
  targetAt(sx: number, sy: number): Target | null {
    // a visitor is drawn over the board: it is what the pointer is on there
    const v = this.visitorAt(sx, sy);
    if (v !== null) return { kind: "visitor", k: v };
    if (2 * LEAF_R * this.cam.k >= NODE_MIN_PX) {
      const i = this.nodeAt(sx, sy);
      if (i !== null) return { kind: "node", i };
    }
    const b = this.foldedAt(sx, sy);
    if (b !== null) return { kind: "cluster", c: b };
    const c = this.clusterAt(sx, sy);
    return c !== null ? { kind: "cluster", c } : null;
  }

  private setHover(t: Target | null, x: number, y: number): void {
    const same = (a: Target | null, b: Target | null) => a === b || (!!a && !!b && sameTarget(a, b));
    this.previewing = false;
    if (!same(t, this.hoverTarget)) {
      this.hoverTarget = t;
      for (const el of this.cards.values()) {
        const mine = t && ((t.kind === "node" && el.dataset.node === String(t.i)) || (t.kind === "cluster" && el.dataset.cluster === String(t.c)));
        el.classList.toggle("hover", !!mine);
      }
      this.request();
    }
    this.ev.hover(t, x, y);
  }

  /** Ring a declaration without moving the view (a row under the pointer in the panel). */
  preview(i: number | null): void {
    this.previewTarget(i === null ? null : { kind: "node", i });
  }

  /** Light a cluster's circle up without moving the view (a row of the cluster's panel). */
  previewCluster(c: number | null): void {
    this.previewTarget(c === null ? null : { kind: "cluster", c });
  }

  private previewTarget(t: Target | null): void {
    if (t === null) {
      if (this.previewing) {
        this.previewing = false;
        this.hoverTarget = null;
        this.request();
      }
      return;
    }
    this.previewing = true;
    const h = this.hoverTarget;
    if (h && sameTarget(h, t)) return;
    this.hoverTarget = t;
    this.request();
  }

  private refreshHover(): void {
    const p = this.pointer;
    if (!p || this.pressing) return;
    this.setHover(this.targetAt(p.sx, p.sy), p.x, p.y);
  }

  // ------------------------------------------------------------------ input

  private bindInput(): void {
    const el = this.canvas;
    let down: Gesture | null = null;

    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    /** Press on a target: it becomes a drag only after DRAG_PX of movement. What is dragged keeps
     *  its offset from the pointer (a card sits beside its point). */
    const press = (e: PointerEvent, t: Target): Gesture => {
      const [sx, sy] = local(e);
      const [wx, wy] = this.toWorld(sx, sy);
      const S = this.scene;
      // locked (the default), or the drag key held on an unlocked layout, or a preview: what it is on
      // stays where it is (on a preview, which would have moved it, the page says why)
      // a finger never moves anything: on a touch screen the board is read, and the lock never lets go
      const moves = e.pointerType !== "touch" && dragMoves(this.locked, dragKeyHeld(e));
      const pan = !this.frozen && moves ? undefined : { cx: this.cam.x, cy: this.cam.y };
      const refused = this.frozen && moves;
      if (t.kind === "visitor") return { kind: "visitor", x: e.clientX, y: e.clientY, k: t.k, moved: false, pan: { cx: this.cam.x, cy: this.cam.y } };
      if (t.kind === "node") return { kind: "node", x: e.clientX, y: e.clientY, i: t.i, dx: wx - S.nwx[t.i], dy: wy - S.nwy[t.i], moved: false, pan, refused };
      return { kind: "cluster", x: e.clientX, y: e.clientY, c: t.c, dx: wx - S.cwx[t.c], dy: wy - S.cwy[t.c], moved: false, pan, refused };
    };
    const pan = (e: PointerEvent): Gesture => ({ kind: "pan", x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false });
    const cardTarget = (card: HTMLElement): Target =>
      card.dataset.cluster ? { kind: "cluster", c: Number(card.dataset.cluster) } : { kind: "node", i: Number(card.dataset.node) };
    /** The last click on a cluster: a second one soon after, where it was, makes a double-click. */
    let last: { c: number; t: number; x: number; y: number } | null = null;
    const soon = (e: PointerEvent) => !!last && performance.now() - last.t < DOUBLE_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < DRAG_PX;
    /** The second press of a double-click is on the cluster of the first, whatever that click lit
     *  up under the pointer meanwhile (a card, a lit point). */
    const again = (e: PointerEvent): Target | null => (e.button === 0 && soon(e) ? { kind: "cluster", c: last!.c } : null);
    /** The press is a Mac's Ctrl+click: let go where it was pressed, it is the menu's (contextmenu). */
    let menu = false;

    // Touch (PhoneSpec decisions 3 and 4): the fingers on the canvas, by pointer. Two make a pinch,
    // which zooms about their middle and moves with it; what the fingers leave after a pinch is no
    // tap. A finger held still on the board opens the menu there; a second tap on empty board, soon
    // after the first, zooms in there.
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { d0: number; k0: number; wx: number; wy: number } | null = null;
    let pinched = false;
    let hold: ReturnType<typeof setTimeout> | null = null;
    let lastTap: { t: number; x: number; y: number } | null = null;
    const unhold = () => {
      if (hold) clearTimeout(hold);
      hold = null;
    };
    const startPinch = () => {
      const [a, b] = [...touches.values()];
      const [sx, sy] = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      const [wx, wy] = this.toWorld(sx, sy);
      pinch = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), k0: this.cam.k, wx, wy };
    };

    // a finger on the board is the board's alone (PhoneSpec decision 5): iOS would take one held
    // still for its own, and select the text it then finds under it (the menu, which opens there)
    // or offer the canvas as an image. Nothing on the board waits for a click; a field being typed
    // in loses the focus, as it would to a press anywhere else.
    el.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        const a = document.activeElement;
        if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) a.blur();
      },
      { passive: false },
    );
    // the right click is the page's: its menu, on what is under the pointer (a card's, on a card)
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const [sx, sy] = local(e);
      this.ev.menu?.(this.targetAt(sx, sy), e.clientX, e.clientY, this.toWorld(sx, sy));
    });
    this.cardsEl.addEventListener("contextmenu", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>(".card");
      if (!card) return;
      e.preventDefault();
      const [sx, sy] = local(e);
      this.ev.menu?.(cardTarget(card), e.clientX, e.clientY, this.toWorld(sx, sy));
    });

    el.addEventListener("pointerdown", (e) => {
      // the right button opens the menu (contextmenu, above) and moves nothing
      if (e.button === 2) return;
      if (e.pointerType === "touch") {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        el.setPointerCapture(e.pointerId);
        if (touches.size >= 2) {
          // a second finger: whatever the first began is a pinch now
          unhold();
          down = null;
          this.pressing = false;
          pinched = true;
          if (touches.size === 2) startPinch();
          return;
        }
        pinched = false;
      }
      menu = menuClick(e);
      const [sx, sy] = local(e);
      // the middle button: the view pans whatever is under the pointer (Space is the source
      // window's, CanvasSpec "Hover, click, drag")
      const t = e.button === 0 ? again(e) ?? this.targetAt(sx, sy) : null;
      down = t ? press(e, t) : pan(e);
      this.pressing = true;
      el.setPointerCapture(e.pointerId);
      // a finger held still: the menu, on what it is on
      if (e.pointerType === "touch") {
        unhold();
        const at = { x: e.clientX, y: e.clientY };
        hold = setTimeout(() => {
          hold = null;
          if (!down || down.moved || touches.size !== 1) return;
          down = null;
          this.pressing = false;
          pinched = true;
          navigator.vibrate?.(10);
          this.ev.menu?.(t, at.x, at.y, this.toWorld(sx, sy));
        }, HOLD_MS);
      }
    });
    // a card is a target of its own
    this.cardsEl.addEventListener("pointerdown", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>(".card");
      if (!card || e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      menu = menuClick(e);
      down = press(e, again(e) ?? cardTarget(card));
      this.pressing = true;
      el.setPointerCapture(e.pointerId);
    });
    this.cardsEl.addEventListener("pointerover", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>(".card");
      if (!card || down) return;
      this.setHover(cardTarget(card), e.clientX, e.clientY);
    });

    el.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch" && touches.has(e.pointerId)) {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && touches.size >= 2) {
          const [a, b] = [...touches.values()];
          const k = Math.min(ZOOM_MOST, Math.max(ZOOM_LEAST, (pinch.k0 * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d0));
          const [mx, my] = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
          // the point that was under the fingers' middle stays under it
          this.cam = { x: pinch.wx - (mx - this.w / 2) / k, y: pinch.wy - (my - this.h / 2) / k, k };
          this.request();
          return;
        }
        if (hold && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) >= DRAG_PX) unhold();
      }
      const [sx, sy] = local(e);
      if (!down) {
        if (e.pointerType === "touch") return;
        this.pointer = { sx, sy, x: e.clientX, y: e.clientY };
        this.refreshHover();
        el.style.cursor = this.hoverTarget ? "pointer" : "grab";
        return;
      }
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (!down.moved && dx * dx + dy * dy < DRAG_PX * DRAG_PX) return;
      if (!down.moved && down.kind !== "pan" && down.refused) this.ev.frozenDrag?.();
      down.moved = true;
      this.ev.hover(null, 0, 0);
      const [wx, wy] = this.toWorld(sx, sy);
      el.style.cursor = "grabbing";
      const from = down.kind === "pan" ? { cx: down.cx, cy: down.cy } : down.pan;
      if (from) {
        this.cam.x = from.cx - dx / this.cam.k;
        this.cam.y = from.cy - dy / this.cam.k;
        this.request();
      } else if (down.kind === "node") {
        this.scene.placeNode(down.i, wx - down.dx, wy - down.dy);
        this.invalidate();
      } else if (down.kind === "cluster") {
        this.scene.placeCluster(down.c, wx - down.dx, wy - down.dy);
        this.invalidate();
      }
    });
    el.addEventListener("pointerleave", () => {
      this.pointer = null;
      if (!down) this.setHover(null, 0, 0);
    });
    // Anywhere but the canvas and the cards, nothing is highlighted. Leaving a card for a panel
    // reaches neither the canvas nor the card's own handlers, and a card can vanish under a still
    // pointer; this catches both.
    document.addEventListener("pointermove", (e) => {
      if (down || !this.hoverTarget || this.previewing) return;
      const t = e.target;
      if (t === el || (t instanceof Element && t.closest(".card"))) return;
      this.pointer = null;
      this.setHover(null, 0, 0);
    });
    document.documentElement.addEventListener("pointerleave", () => {
      if (down) return;
      this.pointer = null;
      this.setHover(null, 0, 0);
    });

    const end = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        touches.delete(e.pointerId);
        unhold();
        if (touches.size < 2) pinch = null;
        // what a pinch, or a menu held open, leaves is no tap
        if (pinched) {
          if (touches.size === 0) pinched = false;
          down = null;
          this.pressing = false;
          return;
        }
        // a second tap on empty board soon after the first, near it: zoom in there
        if (down?.kind === "pan" && !down.moved) {
          const now = performance.now();
          if (lastTap && now - lastTap.t < DOUBLE_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
            lastTap = null;
            down = null;
            this.pressing = false;
            const [sx, sy] = local(e);
            const [wx, wy] = this.toWorld(sx, sy);
            const k = Math.min(ZOOM_MOST, this.cam.k * 2);
            this.moveTo(wx - (sx - this.w / 2) / k + (this.insets.left - this.insets.right) / 2 / k, wy - (sy - this.h / 2) / k + (this.insets.top - this.insets.bottom) / 2 / k, k, true, 260);
            return;
          }
          lastTap = { t: now, x: e.clientX, y: e.clientY };
        }
      }
      if (!down) return;
      const d = down;
      down = null;
      this.pressing = false;
      el.style.cursor = "grab";
      if (d.moved) {
        if (d.kind !== "pan" && !d.pan) {
          this.scene.endDrag();
          this.ev.pinsChanged();
        }
      } else if (menu) {
        // a Mac's Ctrl+click is its right click: the menu opened on it, and it is no click
      } else if (d.kind === "visitor") {
        this.ev.visitorClick?.(d.k, e.shiftKey);
      } else if (d.kind === "node") {
        // a click on the highlighted target selects it, or lets it go
        this.ev.nodeClick(d.i, e.shiftKey);
      } else if (d.kind === "cluster") {
        // a second click on a cluster soon after the first, in the same place, folds or opens it;
        // not a tap, which changes nothing of the board everyone shares
        if (e.pointerType !== "touch" && last?.c === d.c && soon(e)) {
          last = null;
          this.toggleFold(d.c);
        } else {
          last = { c: d.c, t: performance.now(), x: e.clientX, y: e.clientY };
          this.ev.clusterClick(d.c, e.shiftKey);
        }
      } else if (e.button === 0) {
        this.ev.backgroundClick();
      }
      // a finger leaves nothing highlighted: there is no pointer over the board once it is lifted
      if (e.pointerType === "touch") {
        this.pointer = null;
        this.setHover(null, 0, 0);
        return;
      }
      // highlight what is under the pointer now: the gesture may have changed it, and while the
      // pointer was captured no enter or leave reached the canvas
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const card = under instanceof HTMLElement ? under.closest<HTMLElement>(".card") : null;
      const [sx, sy] = local(e);
      this.pointer = under === el ? { sx, sy, x: e.clientX, y: e.clientY } : null;
      if (card) this.setHover(cardTarget(card), e.clientX, e.clientY);
      else if (this.pointer) this.refreshHover();
      else this.setHover(null, 0, 0);
    };
    // pointerup reaches the canvas through capture, also when the gesture began on a card
    window.addEventListener("pointerup", end);
    // the browser took the touch (a system gesture): nothing of it is a tap
    window.addEventListener("pointercancel", (e) => {
      if (e.pointerType !== "touch") return;
      touches.delete(e.pointerId);
      unhold();
      if (touches.size < 2) pinch = null;
      down = null;
      this.pressing = false;
      pinched = touches.size > 0;
    });

    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const [sx, sy] = local(e);
        const [wx, wy] = this.toWorld(sx, sy);
        const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016));
        this.cam.k = Math.min(ZOOM_MOST, Math.max(ZOOM_LEAST, this.cam.k * f));
        // keep the point under the cursor fixed
        this.cam.x = wx - (sx - this.w / 2) / this.cam.k;
        this.cam.y = wy - (sy - this.h / 2) / this.cam.k;
        // what is under the pointer changes with the zoom
        this.pointer = { sx, sy, x: e.clientX, y: e.clientY };
        this.refreshHover();
        this.request();
      },
      { passive: false },
    );
  }

  // ------------------------------------------------------------------ drawing

  /** Screen radius of a node's dot at the current zoom. */
  private dotPx(): number {
    return Math.max(1.3, Math.min(5, 3 * Math.sqrt(this.cam.k)));
  }

  /** Fill the GPU layers from the current state. Positions are in world units, so this runs
   *  when content changes or the scene moves, never because the camera moved. */
  private buildScene(): void {
    const th = this.theme;
    const act = this.active;
    const S = this.scene;
    const g = this.gl;
    const dots = g.layer("dots", "points");
    const rings = g.layer("rings", "points");
    const bubbles = g.layer("bubbles", "circles");
    for (const L of [dots, rings, bubbles]) L.clear();

    // open clusters as circles, parents first so children sit on top; their circles contain
    // exactly what they hold (scene.drawnR). Folded clusters are bodies: shaded discs.
    const discs = g.layer("discs", "circles");
    discs.clear();
    // In the Status scheme a file whose own build failed, is being built or has a sorry has its
    // outline in that state's colour, thin: its declarations say the rest. By kind, every circle is
    // plain (decided 2026-10-08: status is read by switching schemes, not from rings).
    const byStatus = this.scheme === "status";
    // an artwork's style (ExportSpec decision 19): its clusters drawn as cells, each top-level
    // namespace a territory of its own hue — a glow round the outermost, a fill fading from a light,
    // the deeper ones only their rims; or as a starfield's, the outermost two levels' bounds dotted
    const style = this.art?.style ?? "board";
    const glow = g.layer("glow", "points"), figures = g.layer("figures", "lines");
    glow.clear();
    figures.clear();
    for (let c = 0; c < S.nc; c++) {
      if (S.rep[c] >= 0 || !this.clusterVisible(c)) continue;
      const [x, y, r] = [S.cwx[c], S.cwy[c], S.drawnR[c]];
      const depth = this.layout.clusters[c].depth;
      if (style === "cells") {
        const h = this.hueOf(c);
        if (depth === 0) {
          circle(discs, x, y, r, UNIT_WORLD, [0, 0, 0, 0], fade(h, 0.3), 26, FLAG_HALO);
          circle(discs, x, y, r, UNIT_WORLD, fade(h, 0.2), fade(h, 0.6), 1.3, FLAG_RADIAL);
        } else if (depth === 1) circle(discs, x, y, r, UNIT_WORLD, fade(h, 0.12), fade(h, 0.35), 0.9, FLAG_RADIAL);
        else circle(discs, x, y, r, UNIT_WORLD, [0, 0, 0, 0], fade(h, 0.18), 0.6);
        continue;
      }
      if (style === "stars") {
        if (depth <= 1) circle(discs, x, y, r, UNIT_WORLD, [0, 0, 0, 0], rgba(STAR_LINE, depth === 0 ? 0.24 : 0.14), 1, FLAG_DASHED);
        continue;
      }
      const t = byStatus ? this.clusterTrouble[c] ?? -1 : -1;
      if (t < 0) circle(discs, x, y, r, UNIT_WORLD, th.disc, th.discLine, 1);
      else circle(discs, x, y, r, UNIT_WORLD, th.disc, th.status[t], 1.5);
    }
    for (let c = 0; c < S.nc; c++) {
      if (S.rep[c] !== c || !this.clusterVisible(c)) continue;
      const lit = act !== null && this.clusterHasActive(c);
      const base = lit ? th.lit : style === "cells" ? this.hueOf(c) : style === "stars" ? rgba(STAR_LINE) : th.discLine;
      const a = lit ? 1 : style === "board" ? Math.min(1, base[3] * 3 + 0.15) * (act ? 0.5 : 1) : (act ? 0.2 : 0.4);
      const fill: RGBA = [base[0], base[1], base[2], a];
      // a folded cluster: a shaded body; in a starfield, a glow, as a far cluster of stars
      if (style === "stars" && !lit) circle(bubbles, S.cwx[c], S.cwy[c], S.drawnR[c] * 1.4, UNIT_WORLD, fill, null, 0, FLAG_GLOW, 0, 8);
      else circle(bubbles, S.cwx[c], S.cwy[c], S.drawnR[c], UNIT_WORLD, fill, null, 0, FLAG_SHADED, 0, 6);
    }
    if (!this.art) this.tempDiscs(discs);

    // edges of the selection, bundled along the tree, on top of the overview
    const sel = g.layer("selection", "bundles");
    sel.clear();
    if (act && this.edges.length && this.art?.edges !== "none") {
      const count = this.edges.length / 3;
      // the theme's own fading (crowdFade) from fewer: a selection's edges are bundled into few
      // trunks, a hundred of them already one bright band
      const fade = (count < 250 ? 1 : Math.max(0.25, Math.sqrt(250 / count))) * crowdFade(count, 100, th.edgeCrowd);
      const width = count > 4000 ? 1 : 1.6;
      const rep = S.nodeRep;
      const id = (i: number) => (rep[i] >= 0 ? rep[i] : S.nc + i);
      for (let e = 0; e < this.edges.length; e += 3) {
        const a = id(this.edges[e]);
        const b = id(this.edges[e + 1]);
        if (a === b) continue;
        // coloured from the end that uses to the end that is used; an edge that only occurs
        // inside a proof, or on grammar, is drawn fainter: no TCB follows it
        const f = (this.edges[e + 2] & (SITE_STMT | SITE_BODY) ? 1 : 0.33) * fade;
        const [from, to] = this.edgeEnds(a, b, th);
        const c0: RGBA = [from[0], from[1], from[2], from[3] * f];
        const c1: RGBA = [to[0], to[1], to[2], to[3] * f];
        bundle(sel, pathOf(S, a, b), 0.85, width, c0, c1);
      }
    }
    if (!this.art) this.visitBundles(sel);

    // points: dots for declarations, rings for the world outside the project, in the scheme's
    // colours; what is lit is drawn over them in draw(). An artwork's cells give each a glow; its
    // starfield makes each a star, as bright as it is used, its colour the scheme's towards white, and
    // each cluster a constellation
    const dim = act ? 0.22 : 0.9;
    const most = style === "stars" ? this.mostUsed() : 1;
    for (let i = 0; i < this.g.n; i++) {
      if (!this.visibleNode(i) || (act && act[i])) continue;
      if (style === "stars") {
        const x = this.px[i], y = this.py[i];
        // an axiom is a ring here too (web/src/axiomring.ts), round its star
        const ring = ringed(this.g.nodes[i].kind);
        if (this.g.isExt(i)) {
          const faint: RGBA = [0.72, 0.77, 0.88, 0.4 * dim];
          circle(dots, x, y, 0.6, UNIT_DOT, faint);
          if (ring) circle(dots, x, y, 0.6, UNIT_DOT, [0, 0, 0, 0], faint, AXIOM_W, 0, AXIOM_AT);
          continue;
        }
        const c = this.colorOf(i);
        const star: RGBA = [c[0] + (1 - c[0]) * 0.55, c[1] + (1 - c[1]) * 0.55, c[2] + (1 - c[2]) * 0.55, 0.95 * dim];
        const k = 0.65 + 1.15 * (Math.log1p(this.g.inStart[i + 1] - this.g.inStart[i]) / Math.log1p(most));
        circle(glow, x, y, k * 3.4, UNIT_DOT, fade(star, 0.2), null, 0, FLAG_GLOW);
        circle(dots, x, y, k, UNIT_DOT, star);
        if (ring) circle(dots, x, y, k, UNIT_DOT, [0, 0, 0, 0], star, AXIOM_W, 0, AXIOM_AT);
        continue;
      }
      if (style === "cells") {
        const c = this.colorOf(i);
        circle(glow, this.px[i], this.py[i], 2.8, UNIT_DOT, [c[0], c[1], c[2], 0.16 * dim], null, 0, FLAG_GLOW);
      }
      this.point(dots, i, dim, false);
    }
    if (style === "stars") this.constellations(figures, act);
    // a pinned point carries a thin ring: where it is was chosen by hand. Nothing else rings a
    // point but a past graph's marks and an axiom's own ring, inside them; status is the Status
    // scheme's (decided 2026-10-08)
    for (let i = 0; i < this.g.n; i++) {
      if (this.visibleNode(i) && S.isPinned(i)) circle(rings, this.px[i], this.py[i], 1, UNIT_DOT, [0, 0, 0, 0], th.pin, 1, 0, 2.5 + outside(this.g.nodes[i].kind));
    }
    // on a past graph, what changed since and what was renamed since have a ring of their own
    const M = this.pastMarks;
    if (M)
      for (let i = 0; i < this.g.n; i++) {
        if (!(M[i] & (PAST_CHANGED | PAST_RENAMED)) || !this.visibleNode(i)) continue;
        const faded = act && !act[i] ? 0.45 : 1;
        const out = outside(this.g.nodes[i].kind);
        if (M[i] & PAST_CHANGED) circle(rings, this.px[i], this.py[i], 1, UNIT_DOT, [0, 0, 0, 0], fade(th.tmChanged, faded), 1.6, 0, 2.2 + out);
        // a rename is the lighter news: its ring is thinner and fainter than a change's
        if (M[i] & PAST_RENAMED) circle(rings, this.px[i], this.py[i], 1, UNIT_DOT, [0, 0, 0, 0], fade(th.tmRenamed, 0.7 * faded), 1.1, 0, (M[i] & PAST_CHANGED ? 4.4 : 2.2) + out);
      }
  }

  /** Of a cluster, its top-level namespace's hue among the cells' (CELL_HUES, by their size); the
   *  outside world's apart. Read again for each layout. */
  private hueOf(c: number): RGBA {
    if (this.hues?.layout !== this.layout) {
      const C = this.layout.clusters;
      const top = C.map((_, j) => {
        let t = j;
        while (C[t].parent >= 0) t = C[t].parent;
        return t;
      });
      const rank = new Map(C.map((cl, j) => [j, cl] as const).filter(([, cl]) => cl.depth === 0 && !cl.ext).sort((a, b) => b[1].count - a[1].count).map(([j], k) => [j, k]));
      const hues = CELL_HUES.map((h) => rgba(h)), outside = rgba(CELL_OUTSIDE);
      this.hues = { layout: this.layout, of: top.map((t) => (C[t].ext ? outside : hues[(rank.get(t) ?? 0) % hues.length])) };
    }
    return this.hues.of[c] ?? rgba(CELL_OUTSIDE);
  }

  /** The hue of what a bundled edge's end is (a cluster, or a declaration, past the clusters' ids). */
  private hueOfId(id: number): RGBA {
    const S = this.scene;
    return this.hueOf(id < S.nc ? id : this.layout.cluster[id - S.nc]);
  }

  /** How often the declaration used most is used: what a star's size is measured against. */
  private mostUsed(): number {
    if (this.used?.g !== this.g) {
      let m = 1;
      for (let i = 0; i < this.g.n; i++) m = Math.max(m, this.g.inStart[i + 1] - this.g.inStart[i]);
      this.used = { g: this.g, most: m };
    }
    return this.used.most;
  }

  /** The starfield's constellations (ExportSpec decision 19): in each open cluster, the stars it
   *  holds itself — the seven used most — joined by the shortest lines that join them all. */
  private constellations(L: ReturnType<Renderer["layer"]>, act: Uint8Array | null): void {
    const S = this.scene;
    const own = new Map<number, number[]>();
    for (let i = 0; i < this.g.n; i++) {
      if (!this.visibleNode(i) || this.g.isExt(i)) continue;
      const c = this.layout.cluster[i];
      if (c < 0 || S.rep[c] >= 0) continue;
      let m = own.get(c);
      if (!m) own.set(c, (m = []));
      m.push(i);
    }
    const used = (i: number) => this.g.inStart[i + 1] - this.g.inStart[i];
    const colour = rgba(STAR_LINE, act ? 0.16 : 0.38);
    for (const members of own.values()) {
      if (members.length < 2) continue;
      const stars = members.sort((a, b) => used(b) - used(a) || a - b).slice(0, 7);
      // Prim's: from the brightest, each time the nearest star not yet joined
      const joined = [stars[0]];
      const rest = stars.slice(1);
      while (rest.length) {
        let best = Infinity, from = -1, k = -1;
        for (const a of joined)
          for (let j = 0; j < rest.length; j++) {
            const d = (this.px[a] - this.px[rest[j]]) ** 2 + (this.py[a] - this.py[rest[j]]) ** 2;
            if (d < best) [best, from, k] = [d, a, j];
          }
        const b = rest.splice(k, 1)[0];
        segment(L, this.px[from], this.py[from], this.px[b], this.py[b], colour, 0.9);
        joined.push(b);
      }
    }
  }

  /** A node's colour in the scheme in force. */
  private colorOf(i: number): RGBA {
    const th = this.theme;
    if (this.scheme !== "kind") return th.status[this.statusCode[i] ?? ST_UNREVIEWED];
    return this.g.isExt(i) ? th.ext : th.kind[this.g.nodes[i].kind] ?? th.ext;
  }

  /** Draw node `i` as a point into `L`: a dot in its colour, `alpha` its opacity. The world outside
   *  the project is a ring in either scheme, so the project's boundary reads by shape too. In the
   *  Status scheme what nobody has reviewed yet is a plain light grey dot (2026-10-09), set apart
   *  from trusted's pale green by hue and from failed's grey by lightness. `lit` points are larger,
   *  on a halo of the canvas's colour. */
  private point(L: ReturnType<Renderer["layer"]>, i: number, alpha: number, lit: boolean): void {
    const c = this.colorOf(i);
    const a = (x: number): RGBA => [c[0], c[1], c[2], c[3] * x];
    const x = this.px[i], y = this.py[i];
    // on a past graph (HistorySpec decision 17): a ghost of what is gone now, pale in a ring of its
    // own colour. Lit, it is drawn lit as any point is, its mark a ring around it: a faint point read
    // as one left out of the selection
    const m = this.pastMarks?.[i] ?? 0;
    // an axiom is a ring (the owner's decision of 2026-10-18: web/src/axiomring.ts): round its point
    // a gap apart, in the point's colour, lit or not, outside the project too; a past mark outside it
    const kind = this.g.nodes[i].kind;
    const ring = ringed(kind);
    if (lit) {
      // the lit point's halo of the canvas's colour is the ring's gap
      circle(L, x, y, LIT, UNIT_DOT, c, this.theme.bg, 1.5, 0, 0.75);
      if (ring) circle(L, x, y, LIT, UNIT_DOT, [0, 0, 0, 0], c, AXIOM_W, 0, AXIOM_AT);
      if (m & PAST_GHOST) circle(L, x, y, LIT, UNIT_DOT, [0, 0, 0, 0], this.theme.tmGone, 1.3, 0, 2.6 + outside(kind));
      return;
    }
    if (m & PAST_GHOST) {
      circle(L, x, y, 1, UNIT_DOT, a(0.28 * alpha), fade(this.theme.tmGone, alpha), 1.5, 0, -0.4);
      if (ring) circle(L, x, y, 1, UNIT_DOT, [0, 0, 0, 0], a(0.5 * alpha), AXIOM_W, 0, AXIOM_AT);
      return;
    }
    if (this.g.isExt(i)) circle(L, x, y, 0.8, UNIT_DOT, [0, 0, 0, 0], a(alpha), 1.3, 0, -0.6);
    else circle(L, x, y, 1, UNIT_DOT, a(alpha));
    // round a point of one, so that the ring of one outside the project stands where a dot's would
    if (ring) circle(L, x, y, 1, UNIT_DOT, [0, 0, 0, 0], a(alpha), AXIOM_W, 0, AXIOM_AT);
  }

  private draw(): void {
    if (!this.scene) return;
    const t0 = performance.now();
    this.visitW = this.visits ? visitWorld(this.visits, this.scene) : null;
    if (this.sceneDirty) {
      this.sceneDirty = false;
      this.buildScene();
    }
    const dotR = this.dotPx();
    // which active nodes are on screen decides cards and the bright points, every frame
    const onScreen = (sx: number, sy: number, pad: number) => sx > -pad && sy > -pad && sx < this.w + pad && sy < this.h + pad;
    const activeDots: number[] = [];
    if (this.active) {
      for (const i of this.activeList) {
        if (!this.visibleNode(i)) continue;
        const [sx, sy] = this.toScreen(this.px[i], this.py[i]);
        if (onScreen(sx, sy, 8)) activeDots.push(i);
      }
    }
    this.drawCards(activeDots);
    const th = this.theme;
    const active = this.gl.layer("active", "points");
    active.clear();
    // every lit point, those with a card too: the card is beside it, not over it
    for (const i of activeDots) this.point(active, i, 1, true);
    this.drawHover();
    this.drawOverview();
    if (this.posDirty) {
      this.posDirty = false;
      const S = this.scene;
      const P = this.posData;
      for (let c = 0; c < S.nc; c++) {
        P[2 * c] = S.cwx[c];
        P[2 * c + 1] = S.cwy[c];
      }
      for (let i = 0; i < S.n; i++) {
        P[2 * (S.nc + i)] = S.nwx[i];
        P[2 * (S.nc + i) + 1] = S.nwy[i];
      }
      // the visitors' own ids, past the scene's (web/src/visits.ts, visitChain)
      const W = this.visitW;
      if (W && W.tx.length + W.vx.length <= VISIT_SLOTS) {
        const base = S.nc + S.n, T = W.tx.length;
        for (let t = 0; t < T; t++) [P[2 * (base + t)], P[2 * (base + t) + 1]] = [W.tx[t], W.ty[t]];
        for (let k = 0; k < W.vx.length; k++) [P[2 * (base + T + k)], P[2 * (base + T + k) + 1]] = [W.vx[k], W.vy[k]];
      }
      this.gl.setPositions(P);
    }
    this.gl.render(this.cam, this.w, this.h, this.dpr, dotR);
    this.drawLabels(onScreen, dotR);
    this.onFrame?.();
    this.drawMs = performance.now() - t0;
  }

  /** For the frame meter: what one frame costs and what it draws. */
  stats(): Record<string, number> {
    const L = (n: string, k: "circles" | "points" | "bundles") => this.gl.layer(n, k).count;
    return {
      fps: Math.round(1000 / Math.max(1, this.frameMs)),
      drawMs: Math.round(this.drawMs * 10) / 10,
      dots: L("dots", "points"),
      circles: L("discs", "circles"),
      bundles: L("overview", "bundles") + L("selection", "bundles"),
      awake: this.scene?.moving ? 1 : 0,
    };
  }

  /** The edges with nothing selected: statement and body edges (proofs when asked) between the
   *  units visible at this zoom, aggregated and bundled. Everything the overview draws follows the
   *  zoom continuously (the owner's request, 2026-10-10): what is drawn is chosen at zoom points a
   *  quarter of a step (a step: a half octave) apart, and the camera, between two of them, draws both,
   *  blended by where it is — an edge the zoom brings in grows in, one it takes out fades, a bundle
   *  that splits into finer edges dissolves into them, as the zoom goes on and back as it comes back.
   *  At each point, the aggregations of the two steps it lies between are both chosen from, blended
   *  the same way (web/src/overview.ts). An edge both of two blended sets hold is drawn once, between
   *  its two looks. What a point draws is chosen for what is on screen: zoomed out, the heaviest
   *  bundles of the whole project; zoomed in, the dependencies among the declarations in view, and
   *  what they depend on or are used by beyond it. Chosen again when the view has moved by a sixth of
   *  itself, at most every 150 ms, and once more when it stops; again when a fold, a toggle, the
   *  selection or the mode changes.
   *
   *  The points are chosen off the page's thread (web/src/edgequeue.ts; the owner's request,
   *  2026-10-10): the page asks for the two the camera needs and the next one in the direction it
   *  zooms, and a frame never waits for one. While a point the camera needs is not there, what is at
   *  hand is drawn — the nearest points there on either side, blended by where the camera lies between
   *  them, or the nearest one at full weight; when it comes, what is drawn moves on to the camera's own
   *  blend as the zoom goes on, at up to twice the zoom's pace (CATCH_UP), never by time. A camera
   *  whose zoom has come to rest (ZOOM_REST) has no zoom left to ease along: what is drawn is settled
   *  to its blend at once. */
  private drawOverview(): void {
    const S = this.scene;
    const L = this.gl.layer("overview", "bundles");
    const Q = this.edgeQ;
    if (!this.showEdges || (this.art && this.art.edges !== "all")) {
      L.clear();
      this.overviewBase = "";
      this.drawnW = null;
      this.overviewDrawn = "";
      return;
    }
    if (this.overviewGraph !== this.g) {
      this.overviewGraph = this.g;
      Q.setGraph(this.g);
      this.overviewBase = "";
    }
    const base = `${this.sceneSerial}|${S.repVersion}|${this.showExternals}`;
    if (base !== this.overviewBase) {
      // what was drawn stays until the new points come (after a fold, a toggle), unless it is of
      // another scene, whose clusters it names
      if (!this.overviewBase.startsWith(`${this.sceneSerial}|`)) L.clear();
      this.overviewBase = base;
      Q.setBase(S, { externals: this.showExternals });
      this.drawnW = null;
      this.overviewDrawn = "";
    }
    // the overview steps back under a selection: the points chosen before are scaled to it as they
    // are drawn, and asked again once a selection comes or goes; a rebuilt scene, another click or
    // another mode choose nothing anew (a fold's animation rebuilds the scene every frame)
    const style = this.active ? "dim" : "";
    if (style !== this.overviewStyled) {
      this.overviewStyled = style;
      this.overviewStyle++;
    }
    const cam = this.cam;
    const now = performance.now();
    const z = zoomPoint(cam.k);
    const i0 = Math.floor(z);
    const dz = isNaN(this.overviewZ) ? 0 : z - this.overviewZ;
    // the zoom's pace where it keeps going (this frame's change and the one before alike, within
    // 100 ms): the smaller of the two. A single jump (a wheel's notch) has none
    const goes = dz !== 0 && Math.sign(dz) === Math.sign(this.zoomLast) && now - this.zoomAt < 100;
    const pace = goes ? Math.sign(dz) * Math.min(Math.abs(dz), Math.abs(this.zoomLast)) : 0;
    // slowing down by as much a frame: it comes to rest about pace² / 2·slowing further on
    const slowing = goes ? Math.abs(this.zoomLast) - Math.abs(dz) : 0;
    if (dz !== 0) {
      this.zoomAt = now;
      this.zoomDir = Math.sign(dz);
      this.zoomLast = dz;
    }
    this.overviewZ = z;
    const local = Q.onPageThread;
    // where the zoom will be by the time an answer comes (as long as answers have been taking, in
    // frames, and half a frame more): when that is a point or more away, the camera's own points would
    // be passed before they came, and the point it heads for is asked for instead — the camera blends
    // towards it from what it has
    let lead = local ? 0 : pace * Math.min(LEAD, Math.max(1, Q.wait / Math.max(8, this.frameMs) + 0.5));
    if (slowing > 0) lead = Math.sign(lead) * Math.min(Math.abs(lead), (pace * pace) / (2 * slowing));
    const fast = Math.abs(lead) >= 1;
    const head = lead > 0 ? Math.ceil(z + lead) : Math.floor(z + lead);
    // the points kept: the camera's two and one on either side for the way back; with a worker, one
    // more either way for a point asked ahead, those about the point the zoom heads for, and all
    // between the camera and what is drawn while that is late (an answer there is still news)
    let lo = i0 - (local ? 1 : 2), hi = i0 + (local ? 2 : 3);
    if (fast) {
      lo = Math.min(lo, head - 2);
      hi = Math.max(hi, head + 2);
    }
    for (const x of this.drawnW ?? []) {
      lo = Math.min(lo, x.point);
      hi = Math.max(hi, x.point);
    }
    // a camera flying somewhere (fit, a search hit, the zoom buttons) two points or more away: where it
    // lands is asked for first, for its centre there, so that it lands on points of its own
    const goal = this.camGoal;
    const zg = goal ? zoomPoint(goal.k) : NaN;
    const g0 = Math.floor(zg);
    const flying = !local && goal !== null && Math.abs(zg - z) >= 2;
    if (flying) {
      lo = Math.min(lo, g0);
      hi = Math.max(hi, g0 + 1);
    }
    Q.near(lo, hi);
    const dim = this.active !== null;
    const askAt = (i: number, x: number, y: number, pri: number) => Q.ask({ point: i, x, y, w: this.w, h: this.h, dim, style: this.overviewStyle, pri }, () => S);
    const ask = (i: number, pri: number) => askAt(i, cam.x, cam.y, pri);
    if (flying)
      for (const i of [g0, g0 + 1]) {
        const latest = Q.asked(i) ?? Q.points.get(i);
        const away = latest && (Math.abs(goal.x - latest.x) * goal.k >= this.w / 6 || Math.abs(goal.y - latest.y) * goal.k >= this.h / 6);
        if (!latest || latest.style !== this.overviewStyle || away) askAt(i, goal.x, goal.y, 0);
      }
    // a point is chosen again once the view has moved a sixth of itself since it was chosen (or
    // asked for), or the selection or the mode changed since
    const stale = (p: { x: number; y: number }) => Math.abs(cam.x - p.x) * cam.k >= this.w / 6 || Math.abs(cam.y - p.y) * cam.k >= this.h / 6;
    let waiting = false;
    for (const i of fast ? [head] : [i0, i0 + 1]) {
      const latest = Q.asked(i) ?? Q.points.get(i);
      if (!latest || latest.style !== this.overviewStyle) ask(i, 0);
      else if (stale(latest)) {
        if (performance.now() - this.overviewAt < 150) waiting = true;
        else if (ask(i, 0)) this.overviewAt = performance.now();
      }
    }
    if (waiting && this.overviewTimer === null) {
      // throttled: keep what is chosen, and look again once the wait is over, even if the view has
      // stopped by then
      this.overviewTimer = setTimeout(() => {
        this.overviewTimer = null;
        this.request();
      }, 150);
    }
    // ahead in the direction the zoom goes, so that the camera finds its next point there: the next
    // one, and the one after it while the zoom is fast
    if (!local && this.zoomDir !== 0) {
      const d = this.zoomDir;
      const from = fast ? head : d > 0 ? i0 + 1 : i0;
      for (let n = 1; n <= 2 && (n === 1 || Math.abs(dz) >= 0.5); n++) {
        const i = from + n * d;
        if (!Q.points.has(i) && !Q.asked(i)) ask(i, 1);
      }
    }
    const target = aim(z, Q.points.keys(), [lo, hi]);
    // nothing chosen yet: what was drawn stays
    if (!target) return;
    const atRest = now - this.zoomAt >= ZOOM_REST;
    let W = this.drawnW && this.drawnW.every((x) => Q.points.has(x.point)) ? this.drawnW : null;
    if (W) W = ease(W, target, atRest ? Infinity : CATCH_UP * Math.abs(dz));
    else {
      // a new base: what was drawn stays until the camera's own points are there, or, while it
      // zooms, any
      const own = Q.points.has(i0) && (z === i0 || Q.points.has(i0 + 1));
      if (!own && atRest) return;
      W = target;
    }
    this.drawnW = W;
    // late, and still zooming: once the zoom rests, what is drawn is settled to the camera's blend
    if (!atRest && this.restTimer === null && weightGap(W, target) > 1e-9) {
      this.restTimer = setTimeout(() => {
        this.restTimer = null;
        this.request();
      }, this.zoomAt + ZOOM_REST - now + 1);
    }
    // the points far from the camera are let go, but not one still drawn
    Q.evict((i) => (i >= lo && i <= hi) || W.some((x) => x.point === i));
    const dimNow = dim ? DIM : 1;
    const sets: Weighted[] = W.map(({ point, w }) => {
      const p = Q.points.get(point)!;
      return { looks: p.looks, index: Q.indexOf(p), w, scale: dimNow / (p.dim ? DIM : 1) };
    });
    const drawn = `${this.themeSerial}|${this.overviewStyle}|${dim}|${W.map((x) => `${Q.points.get(x.point)!.serial}:${x.w.toFixed(3)}`).join(",")}`;
    if (drawn === this.overviewDrawn) return;
    this.overviewDrawn = drawn;
    const c0: RGBA = [0, 0, 0, 0], c1: RGBA = [0, 0, 0, 0];
    const styled = !!this.art && this.art.style !== "board";
    L.clear();
    blendPoints(sets, (P, j, beta, width, alpha) => {
      // from the part that uses to the part it uses
      // the theme's colours at the overview's opacity; an artwork style's at theirs times it
      const [from, to] = this.edgeEnds(P.path[8 * j], P.path[8 * j + P.len[j] - 1], this.theme);
      [c0[0], c0[1], c0[2], c0[3]] = [from[0], from[1], from[2], (styled ? from[3] : 1) * alpha];
      [c1[0], c1[1], c1[2], c1[3]] = [to[0], to[1], to[2], (styled ? to[3] : 1) * alpha];
      bundlePath(L, P.path, 8 * j, P.len[j], beta, width, c0, c1);
    });
    // the theme's own fading with their number (crowdFade), from the number at which the overview's
    // choice starts fading them (web/src/overview.ts, looksOf)
    const k = crowdFade(L.count, OVERVIEW_CROWD, this.theme.edgeCrowd);
    if (k < 1)
      for (let n = 0; n < L.count; n++) {
        const o = n * BUNDLE_STRIDE;
        L.data[o + 15] *= k;
        L.data[o + 19] *= k;
      }
  }

  /** The colours of a bundled edge from `a` to `b` (ids of the scene's clusters, and of its
   *  declarations past them), from the end that uses: the theme's; an artwork's cells', from one
   *  territory's hue to the other's; its starfield's, a faint starlight. Their opacity is the most
   *  the edge has. */
  private edgeEnds(a: number, b: number, th: { edgeFrom: RGBA; edgeTo: RGBA }): [RGBA, RGBA] {
    const style = this.art?.style ?? "board";
    if (style === "cells") return [fade(this.hueOfId(a), 0.7), fade(this.hueOfId(b), 0.7)];
    if (style === "stars") return [rgba(STAR_LINE, 0.2), rgba(STAR_LINE, 0.2)];
    return [th.edgeFrom, th.edgeTo];
  }

  /** The highlight of what the pointer is on: a cluster's circle lit, or a ring round a point. */
  private drawHover(): void {
    const S = this.scene;
    const th = this.theme;
    const C = this.gl.layer("hoverC", "circles");
    const P = this.gl.layer("hoverP", "points");
    C.clear();
    P.clear();
    const t = this.hoverTarget;
    if (!t || t.kind === "visitor" || this.art) return;
    const a = th.lit;
    if (t.kind === "cluster") {
      if (S.rep[t.c] >= 0 && S.rep[t.c] !== t.c) return;
      const shut = S.rep[t.c] === t.c;
      circle(C, S.cwx[t.c], S.cwy[t.c], S.drawnR[t.c], UNIT_WORLD, [a[0], a[1], a[2], shut ? 0 : 0.05], [a[0], a[1], a[2], 0.9], 2, 0, shut ? 3 : 0, 6);
    } else if (this.visibleNode(t.i)) {
      circle(P, this.px[t.i], this.py[t.i], 1, UNIT_DOT, [0, 0, 0, 0], [a[0], a[1], a[2], 0.95], 2, 0, 3.5 + outside(this.g.nodes[t.i].kind));
    }
  }

  /** Text: cluster labels, labels of folded clusters, names up close. */
  private drawLabels(onScreen: (sx: number, sy: number, pad: number) => boolean, dotR: number): void {
    const ctx = this.ctx;
    const k = this.cam.k;
    const th = this.theme;
    const S = this.scene;
    ctx.setTransform(...(this.labelBase ?? ([this.dpr, 0, 0, this.dpr, 0, 0] as const)));
    ctx.clearRect(0, 0, this.w, this.h);
    // under everything else written here: the names, marks and rings read over them
    this.drawKeyEdges(dotR);
    const act = this.active;
    ctx.textAlign = "center";
    // A label that would cover one already drawn is left out. Parents come before their children,
    // so where a sub-cluster touches the top of its parent, the parent keeps its name; declaration
    // names come last. Boxes are kept in a screen grid, so the check stays cheap with hundreds.
    const CELL = 40;
    const cols = Math.ceil(this.w / CELL) + 1, rows = Math.ceil(this.h / CELL) + 1;
    const grid: number[][] = Array.from({ length: cols * rows }, () => []);
    const boxes: number[] = [];
    const cells = (x0: number, y0: number, x1: number, y1: number, f: (cell: number[]) => boolean | void): boolean => {
      const c0 = Math.max(0, Math.floor(x0 / CELL)), c1 = Math.min(cols - 1, Math.floor(x1 / CELL));
      const r0 = Math.max(0, Math.floor(y0 / CELL)), r1 = Math.min(rows - 1, Math.floor(y1 / CELL));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (f(grid[r * cols + c]) === true) return true;
      return false;
    };
    const free = (x0: number, y0: number, x1: number, y1: number): boolean =>
      !cells(x0, y0, x1, y1, (cell) => cell.some((j) => x0 < boxes[j + 2] && x1 > boxes[j] && y0 < boxes[j + 3] && y1 > boxes[j + 1]));
    const take = (x0: number, y0: number, x1: number, y1: number) => {
      const j = boxes.length;
      boxes.push(x0, y0, x1, y1);
      cells(x0, y0, x1, y1, (cell) => void cell.push(j));
    };
    // the clusters' names written, in the world: where a visitor is not put (`crowded`), and where a
    // note's card keeps off its own cluster's name (`labelOf`)
    const labels: number[] = [];
    const named = new Map<number, number>();
    const art = this.art;
    // an artwork's names by selection (the owner's decision of 2026-10-15): those shown written first,
    // wherever they fall; then As shown, or nothing, without those hidden — whose room stays empty,
    // so that hiding a name brings no other in its place
    const chosen = art?.labels === "chosen";
    const asShown = !art || art.labels === "board" || (chosen && art.namesFrom === "board");
    const hidden = (id: string) => chosen && art!.hidden.has(id);
    const extra = (id: string) => chosen && art!.shown.has(id);
    // the names, written last, over every mark (writeNames); and, on an artwork, what each names
    const written: Written[] = [];
    const wrote = new Set<string>();
    const write = (text: string, x: number, y: number, id: string) => {
      written.push({ text, x, y, font: ctx.font, align: ctx.textAlign, fill: String(ctx.fillStyle) });
      if (id) wrote.add(id);
    };
    /** a name centred on `cx`, where it covers no other; `id`, what it names; `force`, written all
     *  the same; hidden, its room kept and nothing written */
    const place = (text: string, cx: number, baseline: number, size: number, id = "", force = false): boolean => {
      const w = ctx.measureText(text).width / 2 + 3;
      const x0 = cx - w, x1 = cx + w, y0 = baseline - size, y1 = baseline + size * 0.3;
      if (!force && !free(x0, y0, x1, y1)) return false;
      take(x0, y0, x1, y1);
      if (hidden(id)) return true;
      write(text, cx, baseline, id);
      labels.push(...this.toWorld(x0, y0), ...this.toWorld(x1, y1));
      return true;
    };
    // a declaration's name beside its point, where it covers no other name (`force`: all the same);
    // hidden, its room kept
    const nameAt = (i: number, text: string, w: number, force = false): boolean => {
      const [sx, sy] = this.toScreen(this.px[i], this.py[i]);
      // an axiom's name stands clear of its ring (web/src/axiomring.ts), its halo too, lit or not
      const kind = this.g.nodes[i].kind;
      const off = ringed(kind) ? outside(kind) + 1 + (this.active?.[i] ? (LIT - 1) * dotR : 0) : 0;
      const x0 = sx + dotR + 2 + off, y0 = sy - 7, x1 = x0 + w + 2, y1 = sy + 5;
      if (!force && !free(x0, y0, x1, y1)) return false;
      take(x0, y0, x1, y1);
      const id = art ? artNameId("decl", this.g.nodes[i].name) : "";
      if (hidden(id)) return false;
      write(text, sx + dotR + 3 + off, sy + 3.5, id);
      return true;
    };
    const shown = (i: number) => {
      if (!this.visibleNode(i)) return false;
      const [sx, sy] = this.toScreen(this.px[i], this.py[i]);
      return onScreen(sx, sy, 8);
    };
    const targets = art ? this.markedTargets() : [];
    // an artwork's names (the owner's decisions of 2026-10-15): in its fonts and its style's colours;
    // a cluster's along the top of its circle where it fits there (arc labels), a top-level one in
    // spaced capitals, the others in italics; under a folded one's disc, or inside the top of a
    // circle too small for the arc, straight
    const look = art ? artText(art.style, th) : null;
    /** `how`: written all the same (true); where the board writes it, wherever it falls, but only
     *  where it covers no name already written ("fit": a recipe's rule chose it); or as the board
     *  writes names (false) */
    const artCluster = (c: number, how: boolean | "fit"): boolean => {
      const force = how === true, anywhere = how !== false;
      const L = look!;
      const cl = this.layout.clusters[c];
      const id = artNameId("cluster", cl.key);
      const [sx, sy] = this.toScreen(S.cwx[c], S.cwy[c]);
      ctx.fillStyle = L.clusterFill;
      ctx.textAlign = "center";
      if (S.rep[c] === c) {
        const r = Math.max(6, S.drawnR[c] * k);
        if (!anywhere && (r <= 10 || !onScreen(sx, sy, r) || (act && this.clusterHasActive(c)))) return false;
        ctx.font = L.sub(11);
        return place(cl.label, sx, sy + r + 13, 11, id, force);
      }
      const sr = S.drawnR[c] * k;
      if (!anywhere && (sr <= 38 || !onScreen(sx, sy, sr))) return false;
      const top = cl.depth === 0;
      const size = Math.max(10, Math.min(top ? 22 : 16, 9 + sr / 40));
      const text = top ? cl.label.toUpperCase() : cl.label;
      const font = top ? L.top(size) : L.sub(size);
      const sp = L.spacing(top, size);
      ctx.font = font;
      const len = spacedWidth(ctx, text, sp);
      const R = sr - size * 0.35 - 6;
      const half = len / Math.max(R, 1) / 2;
      let box: [number, number, number, number];
      let item: Written;
      if (sr > 60 && half < Math.PI * 0.45) {
        const reach = R * Math.sin(half) + 4;
        box = [sx - reach, sy - sr, sx + reach, sy - R * Math.cos(half) + size * 0.4];
        item = { text, x: sx, y: sy, font, align: "center", fill: L.clusterFill, spacing: sp, arc: { cx: sx, cy: sy, r: R } };
      } else {
        const by = sr > 38 ? sy - sr + size + 6 : sy - sr - 4;
        box = [sx - len / 2 - 3, by - size, sx + len / 2 + 3, by + size * 0.3];
        item = { text, x: sx, y: by, font, align: "center", fill: L.clusterFill, spacing: sp };
      }
      if (!force && !free(...box)) return false;
      take(...box);
      if (hidden(id)) return true;
      written.push(item);
      wrote.add(id);
      labels.push(...this.toWorld(box[0], box[1]), ...this.toWorld(box[2], box[3]));
      named.set(c, labels.length - 4);
      return true;
    };
    ctx.fillStyle = th.label;
    // the clusters' shown, where the board writes them
    if (chosen)
      for (let c = 0; c < S.nc; c++) {
        const cl = this.layout.clusters[c];
        if (!this.artClusters.has(cl.key) || (S.rep[c] >= 0 && S.rep[c] !== c) || !this.clusterVisible(c)) continue;
        const [sx, sy] = this.toScreen(S.cwx[c], S.cwy[c]);
        if (onScreen(sx, sy, 400)) artCluster(c, true);
      }
    // the declarations' shown, beside their points: a target marked in bold
    if (chosen) {
      const bold = new Set(targets);
      ctx.textAlign = "left";
      for (const name of this.artDecls) {
        const i = this.g.byName.get(name);
        if (i === undefined || !shown(i)) continue;
        ctx.font = bold.has(i) ? look!.target : look!.decl;
        ctx.fillStyle = bold.has(i) ? look!.clusterFill : look!.declFill;
        nameAt(i, this.g.short(i), ctx.measureText(this.g.short(i)).width, true);
      }
      ctx.textAlign = "center";
      ctx.fillStyle = th.label;
    }
    // the names a recipe's rule chose (ExportSpec decision 20; the owner's decision of 2026-10-15:
    // never one over another): after those shown, each where the board writes it, only where it
    // covers no name already written — a parent's before its children's
    if (chosen) {
      for (let c = 0; c < S.nc; c++) {
        const cl = this.layout.clusters[c];
        if (!this.artRuled.has(cl.key) || this.artClusters.has(cl.key) || (S.rep[c] >= 0 && S.rep[c] !== c) || !this.clusterVisible(c)) continue;
        const [sx, sy] = this.toScreen(S.cwx[c], S.cwy[c]);
        if (onScreen(sx, sy, 400)) artCluster(c, "fit");
      }
      ctx.textAlign = "left";
      for (const name of this.artRuledDecls) {
        const i = this.g.byName.get(name);
        if (i === undefined || !shown(i)) continue;
        ctx.font = look!.decl;
        ctx.fillStyle = look!.declFill;
        nameAt(i, this.g.short(i), ctx.measureText(this.g.short(i)).width);
      }
      ctx.textAlign = "center";
      ctx.fillStyle = th.label;
    }
    for (let c = 0; c < S.nc; c++) {
      if (art?.labels === "none" || (chosen && !asShown)) break;
      if (chosen && (this.artClusters.has(this.layout.clusters[c].key) || this.artRuled.has(this.layout.clusters[c].key))) continue;
      const rep = S.rep[c];
      if (!this.clusterVisible(c)) continue;
      if (art) {
        if (rep < 0 || rep === c) artCluster(c, false);
        continue;
      }
      const cl = this.layout.clusters[c];
      const [sx, sy] = this.toScreen(S.cwx[c], S.cwy[c]);
      if (rep === c) {
        const r = Math.max(6, S.drawnR[c] * k);
        if (r > 10 && onScreen(sx, sy, r) && !(act && this.clusterHasActive(c))) {
          ctx.font = `500 11px ${FONT}`;
          place(cl.label, sx, sy + r + 13, 11, art ? artNameId("cluster", cl.key) : "");
        }
        continue;
      }
      if (rep >= 0) continue;
      const sr = S.drawnR[c] * k;
      if (sr <= 38 || !onScreen(sx, sy, sr)) continue;
      const size = Math.max(10, Math.min(20, 9 + sr / 40));
      ctx.font = `${cl.depth === 0 ? 600 : 500} ${size}px ${FONT}`;
      // covered at the top: one line lower, still inside its own circle
      const id = art ? artNameId("cluster", cl.key) : "";
      if (place(cl.label, sx, sy - sr + size + 6, size, id) || (sr > 4 * size && place(cl.label, sx, sy - sr + 2 * size + 10, size, id))) named.set(c, labels.length - 4);
    }
    // what is the reader's own is not drawn over an artwork: visitors and their clusters, others
    if (!art) this.tempLabels(place, onScreen);
    this.labelBoxes = labels;
    this.labelOfC = named;
    this.drawProgress(onScreen);
    this.drawLeaders();
    // an artwork's key marks have a switch of their own (the owner's decision of 2026-10-15)
    if (!art || art.keys) this.drawKeys(onScreen, dotR);
    this.drawStars(onScreen, dotR);
    if (!art) {
      this.drawVisitors(onScreen);
      this.drawPeers(onScreen, dotR);
    }
    this.drawSelection(dotR);
    // an artwork's (ExportSpec decision 19): its targets' names, marked, before any other; and where
    // something is lit, the lit declarations' names where the board would give them cards, nearest
    // the middle first
    const marked = art && art.labels !== "none" && asShown ? targets.filter((i) => shown(i) && !extra(artNameId("decl", this.g.nodes[i].name))) : [];
    ctx.textAlign = "left";
    ctx.font = look ? look.target : `600 11px ${FONT}`;
    ctx.fillStyle = look ? look.clusterFill : th.label;
    for (const i of marked) nameAt(i, this.g.short(i), ctx.measureText(this.g.short(i)).width);
    const seen = new Set(marked);
    if (chosen) for (const name of this.artDecls) {
      const i = this.g.byName.get(name);
      if (i !== undefined) seen.add(i);
    }
    if (art && asShown && act) {
      ctx.font = look!.decl;
      ctx.fillStyle = look!.declFill;
      const cx = this.w / 2, cy = this.h / 2;
      const lit = this.activeList.filter((i) => !seen.has(i) && shown(i));
      const d = (i: number) => {
        const [sx, sy] = this.toScreen(this.px[i], this.py[i]);
        return (sx - cx) ** 2 + (sy - cy) ** 2;
      };
      lit.sort((a, b) => d(a) - d(b));
      let budget = cardCap(k);
      for (const i of lit) {
        if (budget <= 0) break;
        if (nameAt(i, this.g.short(i), ctx.measureText(this.g.short(i)).width)) budget--;
      }
    }
    if (asShown && k > 1.1 && !act) {
      ctx.font = look ? look.decl : `11px ${FONT}`;
      ctx.textAlign = "left";
      ctx.fillStyle = look ? look.declFill : th.text;
      // declaration names, nearest the middle of the screen first; one that would cover another
      // name (or a cluster's) is left out, so what is written can be read and the edges show
      const cx = this.w / 2, cy = this.h / 2;
      const near: number[] = [];
      const dist: number[] = [];
      for (let i = 0; i < this.g.n; i++) {
        if (!this.visibleNode(i)) continue;
        const [sx, sy] = this.toScreen(this.px[i], this.py[i]);
        if (!onScreen(sx, sy, 8)) continue;
        near.push(i);
        dist[i] = (sx - cx) ** 2 + (sy - cy) ** 2;
      }
      near.sort((a, b) => dist[a] - dist[b]);
      if (this.nameW.length !== this.g.n) this.nameW = new Float32Array(this.g.n).fill(-1);
      let budget = 700;
      for (let t = 0; t < near.length && t < 4000 && budget > 0; t++) {
        const i = near[t];
        if (seen.has(i)) continue;
        let w = this.nameW[i];
        // (the widths kept are in the board's own font; an artwork writes in its own)
        if (look) w = ctx.measureText(this.g.short(i)).width;
        else if (!(w >= 0)) w = this.nameW[i] = ctx.measureText(this.g.short(i)).width;
        if (nameAt(i, this.g.short(i), w)) budget--;
      }
    }
    this.writeNames(written, look?.halo ?? null);
    this.namesWritten = wrote;
  }

  /** The names, over everything else written on the board, each on its halo of the background
   *  (web/src/halo.ts). */
  private writeNames(names: readonly Written[], halo: string | null): void {
    const bg = this.theme.bg;
    writeNames(this.ctx, names, halo ?? `rgb(${Math.round(bg[0] * 255)}, ${Math.round(bg[1] * 255)}, ${Math.round(bg[2] * 255)})`);
  }

  /** In the Status and Mine schemes, how far the review of each cluster on screen has come — the
   *  reader's own in Mine —, on its outline: an arc from the top, clockwise, for the share approved,
   *  then one for the share commented, of what it holds that needs review. Only on circles large
   *  enough to read it, and only where something has been said. */
  private drawProgress(onScreen: (sx: number, sy: number, pad: number) => boolean): void {
    if (this.scheme === "kind" || !this.clusterProgress.length) return;
    const S = this.scene;
    const P = this.clusterProgress;
    const ctx = this.ctx;
    const th = this.theme;
    const css = (c: RGBA) => `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${c[3]})`;
    const colors = [css(th.status[ST_APPROVED]), css(th.status[ST_COMMENTED])];
    ctx.save();
    // thin and a little faded: a summary to glance at, quieter than the selection's ring
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.85;
    ctx.lineCap = "butt";
    for (let c = 0; c < S.nc; c++) {
      const rep = S.rep[c];
      if ((rep >= 0 && rep !== c) || !this.clusterVisible(c)) continue;
      const total = P[3 * c + 2];
      if (!total || P[3 * c] + P[3 * c + 1] === 0) continue;
      const r = rep === c ? Math.max(6, S.drawnR[c] * this.cam.k) : S.drawnR[c] * this.cam.k;
      if (r < 18) continue;
      const [sx, sy] = this.toScreen(S.cwx[c], S.cwy[c]);
      if (!onScreen(sx, sy, r)) continue;
      let a = -Math.PI / 2;
      for (let k = 0; k < 2; k++) {
        const share = P[3 * c + k] / total;
        if (!share) continue;
        ctx.strokeStyle = colors[k];
        ctx.beginPath();
        ctx.arc(sx, sy, r, a, a + share * 2 * Math.PI);
        ctx.stroke();
        a += share * 2 * Math.PI;
      }
    }
    ctx.restore();
  }

  /** A gold five-pointed star on every target: on its point, or on the edge of the folded cluster
   *  hiding it. Never smaller than can be seen. */
  private drawStars(onScreen: (sx: number, sy: number, pad: number) => boolean, dotR: number): void {
    const targets = this.markedTargets();
    if (!targets.length) return;
    const ctx = this.ctx;
    const S = this.scene;
    const star = (x: number, y: number, R: number) => {
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const r = k % 2 ? R * 0.46 : R;
        const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
        if (k) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    ctx.save();
    ctx.fillStyle = this.theme.star;
    ctx.strokeStyle = this.theme.starEdge;
    ctx.lineWidth = 1.2;
    ctx.lineJoin = "round";
    const seen = new Set<number>();
    for (const i of targets) {
      if (this.visibleNode(i)) {
        const [sx, sy] = this.toScreen(this.px[i], this.py[i]);
        if (onScreen(sx, sy, 20)) star(sx, sy, Math.max(9, dotR * 2.2));
        continue;
      }
      // hidden in a folded cluster: one star on the edge of its disc
      const c = S.nodeRep[i];
      if (c < 0 || seen.has(c)) continue;
      seen.add(c);
      const [sx, sy] = this.toScreen(S.cwx[c], S.cwy[c]);
      const r = Math.max(6, S.drawnR[c] * this.cam.k);
      if (onScreen(sx, sy, r + 20)) star(sx + r * 0.71, sy - r * 0.71, 7);
    }
    ctx.restore();
  }

  /** A small diamond on every key declaration, at the top left of its point — the point's colour
   *  still shows, and its name, written to the right, stays clear; hidden in a folded cluster, one
   *  on the edge of its disc, opposite the star's place. Never smaller than can be seen. An artwork
   *  whose targets are chosen draws only the keys of those it chose. */
  private drawKeys(onScreen: (sx: number, sy: number, pad: number) => boolean, dotR: number): void {
    if (!this.keyList.length) return;
    const on = this.art?.targets === "chosen" ? this.chosenTargets() : null;
    const ctx = this.ctx;
    const S = this.scene;
    const diamond = (x: number, y: number, R: number) => {
      ctx.beginPath();
      ctx.moveTo(x, y - R);
      ctx.lineTo(x + R * 0.72, y);
      ctx.lineTo(x, y + R);
      ctx.lineTo(x - R * 0.72, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    ctx.save();
    ctx.fillStyle = this.theme.key;
    ctx.strokeStyle = this.theme.starEdge;
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    const seen = new Set<number>();
    const R = Math.max(4.5, dotR * 1.1);
    for (let j = 0; j < this.keyList.length; j++) {
      const i = this.keyList[j];
      if (on && !this.keyOf[j]?.some((t) => on.has(t))) continue;
      if (this.visibleNode(i)) {
        const [sx, sy] = this.toScreen(this.px[i], this.py[i]);
        // an axiom's: outside its ring (web/src/axiomring.ts)
        const out = outside(this.g.nodes[i].kind) * 0.71;
        if (onScreen(sx, sy, 12)) diamond(sx - dotR - out - R * 0.4, sy - dotR - out - R * 0.3, R);
        continue;
      }
      const c = S.nodeRep[i];
      if (c < 0 || seen.has(c)) continue;
      seen.add(c);
      const [sx, sy] = this.toScreen(S.cwx[c], S.cwy[c]);
      const r = Math.max(6, S.drawnR[c] * this.cam.k);
      if (onScreen(sx, sy, r + 12)) diamond(sx - r * 0.71, sy - r * 0.71, 5);
    }
    ctx.restore();
  }

  /** Others' selections: a ring around the point, split between the readers on it, and their
   *  initials beside; hidden in a folded cluster, the same on the edge of its disc. */
  private drawPeers(onScreen: (sx: number, sy: number, pad: number) => boolean, dotR: number): void {
    if (!this.peerMarks.size) return;
    const ctx = this.ctx;
    const S = this.scene;
    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.font = `600 9.5px ${FONT}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const mark = (x: number, y: number, r: number, m: { colors: string[]; labels: string[] }) => {
      const n = m.colors.length;
      m.colors.forEach((c, k) => {
        ctx.strokeStyle = c;
        ctx.beginPath();
        ctx.arc(x, y, r, -Math.PI / 2 + (k * 2 * Math.PI) / n, -Math.PI / 2 + ((k + 1) * 2 * Math.PI) / n);
        ctx.stroke();
      });
      // the initials, side by side, at the lower right
      m.labels.forEach((label, k) => {
        const bx = x + r * 0.75 + 9 + k * 19, by = y + r * 0.75 + 6;
        ctx.fillStyle = m.colors[k];
        ctx.beginPath();
        ctx.arc(bx, by, 8.5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(label, bx, by + 0.5);
      });
    };
    const folded = new Map<number, { colors: string[]; labels: string[] }>();
    for (const [i, m] of this.peerMarks) {
      if (i < 0 || i >= this.g.n) continue;
      if (this.visibleNode(i)) {
        const [sx, sy] = this.toScreen(this.px[i], this.py[i]);
        if (onScreen(sx, sy, 30)) mark(sx, sy, pickRadius(dotR, this.g.nodes[i].kind), m);
        continue;
      }
      const c = S.nodeRep[i];
      if (c < 0) continue;
      const f = folded.get(c) ?? { colors: [], labels: [] };
      f.colors.push(...m.colors);
      f.labels.push(...m.labels);
      folded.set(c, f);
    }
    for (const [c, m] of folded) {
      const [sx, sy] = this.toScreen(S.cwx[c], S.cwy[c]);
      const r = Math.max(6, S.drawnR[c] * this.cam.k);
      if (onScreen(sx, sy, r + 30)) mark(sx - r * 0.71, sy + r * 0.71, 6, m);
    }
    ctx.restore();
  }

  /** The visitors' temporary clusters (ViewSpec decision 27): circles as the board's are, their
   *  outlines dashed in the labels' colour, under what they hold; none inside a folded cluster. */
  private tempDiscs(L: ReturnType<Renderer["layer"]>): void {
    const V = this.visits, W = this.visitW;
    if (!V || !W) return;
    const th = this.theme;
    const line = fade(th.pin, 0.75);
    for (let t = 0; t < V.plan.temps.length; t++) {
      const c = V.plan.temps[t].in;
      if (W.trep[t] >= 0 || (c >= 0 && !this.clusterVisible(c))) continue;
      circle(L, W.tx[t], W.ty[t], W.tr[t], UNIT_WORLD, th.disc, line, 1.2, FLAG_DASHED);
    }
  }

  /** The temporary clusters' names (ViewSpec decision 27), in italics: inside the top of a circle
   *  large enough on the screen, as a cluster's is, else just above it, or below where that is taken,
   *  each kept off the names already written. */
  private tempLabels(place: (text: string, cx: number, baseline: number, size: number) => boolean, onScreen: (sx: number, sy: number, pad: number) => boolean): void {
    const V = this.visits, W = this.visitW;
    if (!V || !W) return;
    const ctx = this.ctx;
    const k = this.cam.k;
    ctx.fillStyle = this.theme.label;
    V.plan.temps.forEach((t, j) => {
      if (W.trep[j] >= 0 || (t.in >= 0 && !this.clusterVisible(t.in))) return;
      const [sx, sy] = this.toScreen(W.tx[j], W.ty[j]);
      const sr = W.tr[j] * k;
      if (sr < 3 || !onScreen(sx, sy, sr + 60)) return;
      const size = sr > 38 ? Math.max(10, Math.min(20, 9 + sr / 40)) : 11;
      ctx.font = `italic 500 ${size}px ${FONT}`;
      if (sr > 38 && place(t.label, sx, sy - sr + size + 6, size)) return;
      if (!place(t.label, sx, sy - sr - 4, size)) place(t.label, sx, sy + sr + size + 2, size);
    });
  }

  /** The visitors' edges (ViewSpec decision 27), bundled as any edge is: through the visitor's
   *  temporary clusters and the board's tree to what the board holds that it uses or that uses it,
   *  and to the other visitors; coloured from the end that uses to the end used, a reference only in a
   *  proof, or on grammar, fainter. An end inside a folded cluster is on its card, and two ends in one
   *  card draw nothing. */
  private visitBundles(L: ReturnType<Renderer["layer"]>): void {
    const V = this.visits, W = this.visitW;
    if (!V || !W || W.tx.length + W.vx.length > VISIT_SLOTS) return;
    const S = this.scene;
    const th = this.theme;
    const base = S.nc + S.n;
    const up = (c: number, out: number[]) => {
      for (; c >= 0; c = S.parent[c]) out.push(c);
      return out;
    };
    const nodeChain = (j: number): number[] | null => {
      if (j < 0 || j >= this.g.n) return null;
      const r = S.nodeRep[j];
      if (r >= 0) return this.clusterVisible(r) ? up(r, []) : null;
      return this.visibleNode(j) ? up(S.nodeCluster[j], [S.nc + j]) : null;
    };
    const chains = this.visitors.map((_, k) => (k < W.vx.length ? visitChain(V, W, S, base, k) : null));
    const paths = new Map<string, [number[], boolean]>();
    const add = (path: number[], strong: boolean) => {
      if (path[0] === path[path.length - 1]) return;
      const key = path.join(",");
      const was = paths.get(key);
      if (!was || (strong && !was[1])) paths.set(key, [path, strong]);
    };
    this.visitors.forEach((v, k) => {
      const ck = chains[k];
      if (!ck) return;
      for (const [j, incoming, strong] of v.board) {
        const cj = nodeChain(j);
        if (cj) add(incoming ? joinChains(cj, ck) : joinChains(ck, cj), strong);
      }
      // each pair once: from the side of the visitor that uses the other
      for (const [o, incoming, strong] of v.visitors) if (!incoming && chains[o]) add(joinChains(ck, chains[o]!), strong);
    });
    const n = paths.size;
    const fadeBy = n < 250 ? 1 : Math.max(0.25, Math.sqrt(250 / n));
    const width = n > 4000 ? 1 : 1.6;
    for (const [path, strong] of paths.values()) {
      const f = (strong ? 1 : 0.33) * fadeBy;
      bundle(L, path, 0.85, width, fade(th.edgeFrom, f), fade(th.edgeTo, f));
    }
  }

  /** The visitors themselves (ViewSpec decision 27): a point in its colour inside a dashed ring —
   *  temporary, not of the board — on a halo of the canvas's colour, its name beside it in italics, a
   *  target's star and a key declaration's diamond as on any point. One inside a folded cluster is not
   *  drawn: the cluster's card carries a marker, a dashed ring with how many it hides. */
  private drawVisitors(onScreen: (sx: number, sy: number, pad: number) => boolean): void {
    const W = this.visitW;
    if (!this.visitors.length || !W) return;
    const ctx = this.ctx;
    const th = this.theme;
    const css = (c: RGBA, a = 1) => `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${Math.min(1, c[3] * a)})`;
    const R = this.visitorR();
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `italic 500 11px ${FONT}`;
    const hidden = new Map<number, number>();
    this.visitors.forEach((v, k) => {
      if (k >= W.vx.length) return;
      if (W.vrep[k] >= 0) return void hidden.set(W.vrep[k], (hidden.get(W.vrep[k]) ?? 0) + 1);
      const [x, y] = this.toScreen(W.vx[k], W.vy[k]);
      if (!onScreen(x, y, 200)) return;
      const c = this.scheme !== "kind" ? th.status[v.status] ?? th.status[ST_UNREVIEWED] : v.kind === "external" ? th.ext : th.kind[v.kind] ?? th.ext;
      ctx.fillStyle = css(th.bg);
      ctx.beginPath();
      ctx.arc(x, y, R + 3 + (v.axiom ? AXIOM_OUT : 0), 0, 2 * Math.PI);
      ctx.fill();
      // an axiom's ring (web/src/axiomring.ts), solid in its colour outside the visitor's dashed one
      if (v.axiom) {
        ctx.lineWidth = AXIOM_W;
        ctx.strokeStyle = css(c, 0.9);
        ctx.beginPath();
        ctx.arc(x, y, R + 1.75 + AXIOM_AT, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.fillStyle = css(c, 0.9);
      ctx.beginPath();
      ctx.arc(x, y, R - 1.5, 0, 2 * Math.PI);
      ctx.fill();
      // the dashed ring in the labels' colour, which reads on either theme whatever the point's
      ctx.setLineDash([3, 2.2]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = th.label;
      ctx.beginPath();
      ctx.arc(x, y, R + 1, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
      // its name, legible over whatever is under it
      ctx.lineWidth = 3;
      ctx.strokeStyle = css(th.bg, 0.9);
      ctx.strokeText(v.label, x + R + 6, y);
      ctx.fillStyle = th.text;
      ctx.fillText(v.label, x + R + 6, y);
      if (v.target || v.key) {
        ctx.lineWidth = 1;
        ctx.lineJoin = "round";
        ctx.strokeStyle = th.starEdge;
        ctx.beginPath();
        if (v.target) {
          ctx.fillStyle = th.star;
          const S = Math.max(6, R * 1.1);
          for (let q = 0; q < 10; q++) {
            const a = -Math.PI / 2 + (q * Math.PI) / 5;
            const r = q % 2 ? S * 0.46 : S;
            const px = x + R * 0.9 + r * Math.cos(a), py = y - R * 0.9 + r * Math.sin(a);
            if (q) ctx.lineTo(px, py);
            else ctx.moveTo(px, py);
          }
        } else {
          ctx.fillStyle = th.key;
          const D = Math.max(4, R * 0.8), cx = x - R * 0.9, cy = y - R * 0.9;
          ctx.moveTo(cx, cy - D);
          ctx.lineTo(cx + D * 0.72, cy);
          ctx.lineTo(cx, cy + D);
          ctx.lineTo(cx - D * 0.72, cy);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    });
    // the folded clusters that hide visitors: a marker on each card, as a visitor is drawn, and how
    // many where more than one
    ctx.font = `italic 600 10px ${FONT}`;
    for (const [c, n] of hidden) {
      if (!this.clusterVisible(c)) continue;
      const [x, y] = this.visitMarkAt(c);
      if (!onScreen(x, y, 20)) continue;
      ctx.fillStyle = css(th.bg);
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = th.label;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.setLineDash([2.5, 2]);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = th.label;
      ctx.beginPath();
      ctx.arc(x, y, 6.5, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
      if (n > 1) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = css(th.bg, 0.9);
        ctx.strokeText(String(n), x + 10, y);
        ctx.fillStyle = th.text;
        ctx.fillText(String(n), x + 10, y);
      }
    }
    ctx.restore();
  }

  /** The leads from lit declarations to their cards (drawCards): thin, quiet, under the cards. */
  /** The key graph's edges among what is lit, under the Keys step of Rests on (ViewSpec decision
   *  20): dashed, since each says "rests on, through declarations that are not key" rather than a
   *  reference, and slightly bowed rather than bundled along the tree — there are a dozen or so,
   *  and a path through the tree would say nothing of the declarations between. Coloured as every
   *  edge is, from the end that rests on to the end it rests on, and stopped short of both points.
   *  An end inside a folded cluster is on its disc; two ends in one folded cluster draw nothing. */
  private drawKeyEdges(dotR: number): void {
    const E = this.keyEdges;
    if (!E || !E.length) return;
    const S = this.scene;
    const k = this.cam.k;
    /** an end on the screen, and how far short of it the edge stops; null where it is not drawn */
    const end = (i: number): [number, number, number, number] | null => {
      if (i < 0 || i >= this.g.n) return null;
      if (this.visibleNode(i)) {
        const [x, y] = this.toScreen(this.px[i], this.py[i]);
        return [x, y, dotR + 4 + outside(this.g.nodes[i].kind), -1 - i];
      }
      const c = S.nodeRep[i];
      if (c < 0 || !this.clusterVisible(c)) return null;
      const [x, y] = this.toScreen(S.cwx[c], S.cwy[c]);
      return [x, y, Math.max(6, S.drawnR[c] * k) + 3, c];
    };
    const ctx = this.ctx;
    const th = this.theme;
    const css = (c: RGBA) => `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${Math.min(1, c[3] + 0.1)})`;
    const from = css(th.edgeFrom), to = css(th.edgeTo);
    ctx.save();
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.setLineDash([6, 4]);
    const drawn = new Set<string>();
    for (let e = 0; e < E.length; e += 2) {
      const a = end(E[e]), b = end(E[e + 1]);
      if (!a || !b || a[3] === b[3]) continue;
      const id = `${a[3]} ${b[3]}`;
      if (drawn.has(id)) continue;
      drawn.add(id);
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len <= a[2] + b[2] + 4) continue;
      // nothing of it on screen: left out
      if (Math.max(a[0], b[0]) < 0 || Math.min(a[0], b[0]) > this.w || Math.max(a[1], b[1]) < 0 || Math.min(a[1], b[1]) > this.h) continue;
      // bowed to the left of the way it goes, so that two declarations resting on each other show
      // two edges
      const bow = Math.min(36, len * 0.12);
      const ux = dx / len, uy = dy / len;
      const cx = (a[0] + b[0]) / 2 + uy * bow, cy = (a[1] + b[1]) / 2 - ux * bow;
      const toward = (p: [number, number, number, number]) => {
        const vx = cx - p[0], vy = cy - p[1];
        const d = Math.hypot(vx, vy) || 1;
        return [p[0] + (vx / d) * p[2], p[1] + (vy / d) * p[2]];
      };
      const [x0, y0] = toward(a), [x1, y1] = toward(b);
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, from);
      grad.addColorStop(1, to);
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cx, cy, x1, y1);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawLeaders(): void {
    const L = this.leaders;
    if (!L.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.theme.text;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < L.length; k += 5) {
      ctx.moveTo(L[k], L[k + 1]);
      ctx.lineTo(L[k + 2], L[k + 3]);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** The selection on the canvas: a ring round every declaration and every cluster selected (a
   *  cluster's circle, or a folded one's card), and a lead from what the panel tells of to the
   *  panel — a curve that leaves its ring towards the panel and meets the panel's edge level. It is
   *  drawn again while its end moves (the panel sliding in, or scrolled). What lies inside a folded
   *  cluster is ringed on that cluster. */
  private drawSelection(dotR: number): void {
    const S = this.scene;
    const k = this.cam.k;
    /** round a point, clear of an axiom's ring */
    const pointR = (i: number) => pickRadius(dotR, this.g.nodes[i].kind);
    /** a folded cluster's ring: round its card while it has one, else round its body */
    const body = (c: number): Mark => {
      const b = this.clusterBoxes.get(c);
      if (b) return { box: [b[0] - 3, b[1] - 3, b[2] + 3, b[3] + 3], c };
      const [x, y] = this.toScreen(S.cwx[c], S.cwy[c]);
      return { x, y, r: Math.max(6, S.drawnR[c] * k) + 3 };
    };
    const markOf = (t: Target): Mark | null => {
      if (t.kind === "visitor") {
        const W = this.visitW;
        if (!W || t.k < 0 || t.k >= W.vx.length) return null;
        // hidden in a folded cluster: ringed on its card, as a declaration there is
        if (W.vrep[t.k] >= 0) return this.clusterVisible(W.vrep[t.k]) ? body(W.vrep[t.k]) : null;
        const [x, y] = this.toScreen(W.vx[t.k], W.vy[t.k]);
        return { x, y, r: this.visitorR() + 5 + (this.visitors[t.k]?.axiom ? AXIOM_OUT : 0) };
      }
      if (t.kind === "node") {
        if (t.i < 0 || t.i >= this.g.n) return null;
        if (!this.visibleNode(t.i)) return S.nodeRep[t.i] < 0 ? null : body(S.nodeRep[t.i]);
        const [x, y] = this.toScreen(this.px[t.i], this.py[t.i]);
        return { x, y, r: pointR(t.i) };
      }
      if (t.c < 0 || t.c >= S.nc || !this.clusterVisible(t.c)) return null;
      if (S.rep[t.c] >= 0) return body(S.rep[t.c]);
      const [x, y] = this.toScreen(S.cwx[t.c], S.cwy[t.c]);
      return { x, y, r: S.drawnR[t.c] * k + 3 };
    };
    const all: Target[] = [...this.focus.map((i): Target => ({ kind: "node", i })), ...this.picked.map((c): Target => ({ kind: "cluster", c })), ...this.visitorSel.map((k): Target => ({ kind: "visitor", k }))];
    // the pointer on a visitor rings it too: the board's highlight is drawn on the GPU's layers
    if (this.hoverTarget?.kind === "visitor") all.push(this.hoverTarget);
    if (this.lead) all.push(this.lead);
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.theme.accent;
    ctx.fillStyle = this.theme.accent;
    ctx.lineWidth = 2;
    // one ring per place: several declarations in one folded cluster share its ring. A card's ring
    // is the card's own outline (.cluster-card.picked): drawn here, on its lit body, it would not
    // show
    const drawn = new Set<string>();
    const carded = new Set<number>();
    for (const t of all) {
      const m = markOf(t);
      if (!m) continue;
      if ("box" in m) {
        carded.add(m.c);
        continue;
      }
      const key = `${m.x},${m.y},${m.r}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, 2 * Math.PI);
      ctx.stroke();
    }
    for (const el of this.cards.values()) if (el.dataset.cluster !== undefined) el.classList.toggle("picked", carded.has(Number(el.dataset.cluster)));
    // none in an artwork, whose panels are put away (ExportSpec decision 19)
    const lead = !this.art && this.lead && markOf(this.lead);
    if (!lead) return ctx.restore();
    const box = this.canvas.getBoundingClientRect();
    const at = this.leadEnd();
    const end = at ? { x: at.x - box.left, y: at.y - box.top } : null;
    const was = this.leadWas;
    if (!end ? was !== null : !was || Math.abs(was.x - end.x) > 0.5 || Math.abs(was.y - end.y) > 0.5) this.request();
    this.leadWas = end;
    // the lead leaves the ring where it faces the panel: a card's end, a circle's point nearest the
    // panel's edge. None while the panel is away, or when the ring lies under the panel itself.
    let sx: number, sy: number, room: boolean;
    if (!end) room = false;
    else if ("box" in lead) {
      [sx, sy] = [lead.box[2], (lead.box[1] + lead.box[3]) / 2];
      room = end.x > sx + 12;
    } else {
      const a = Math.atan2(end.y - lead.y, end.x - lead.x);
      [sx, sy] = [lead.x + lead.r * Math.cos(a), lead.y + lead.r * Math.sin(a)];
      room = end.x > sx + 12 && Math.hypot(end.x - lead.x, end.y - lead.y) > lead.r + 12;
    }
    if (end && room) {
      const dx = (end.x - sx!) * 0.5;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(sx!, sy!);
      ctx.bezierCurveTo(sx! + dx, sy!, end.x - dx, end.y, end.x - 3, end.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(end.x - 3, end.y, 3, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
  }

  private clusterHasActive(c: number): boolean {
    return this.clusterActive[c] > 0;
  }

  private countActive(): void {
    this.clusterActive = new Int32Array(this.layout ? this.layout.clusters.length : 0);
    if (!this.layout) return;
    for (const i of this.activeList) {
      for (let x = this.layout.cluster[i]; x >= 0; x = this.layout.clusters[x].parent) this.clusterActive[x]++;
    }
  }

  private clearCards(): void {
    for (const el of this.cards.values()) el.remove();
    this.cards.clear();
    this.cardSide.clear();
    this.leaders = [];
    // a card that was highlighted is gone
    if (this.hoverTarget && !this.pointer) this.setHover(null, 0, 0);
    this.cardSize.clear();
  }

  /** Place the cards for this frame; returns the nodes that got one. */
  private drawCards(activeDots: number[]): Set<number> {
    // without a browser there are no cards (ExportSpec decision 21): they are elements of the page
    if (this.headless) return new Set();
    const k = this.cam.k;
    const S = this.scene;
    // what is selected has no card: a ring says where it is (drawSelection)
    const chosen = new Set(this.focus);
    if (this.lead?.kind === "node") chosen.add(this.lead.i);
    // which active nodes get a card: the nearest to the screen centre
    const cx = this.w / 2;
    const cy = this.h / 2;
    const cap = this.art ? 0 : cardCap(k);
    const ranked = activeDots
      .filter((i) => !chosen.has(i))
      .map((i) => {
        const [sx, sy] = this.toScreen(this.px[i], this.py[i]);
        return { i, d: (sx - cx) ** 2 + (sy - cy) ** 2 };
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, cap)
      .map((x) => x.i);
    const want = new Map<string, number>();
    // folded clusters that hold active nodes get a card of their own, on their body; a selected one
    // first, since the selection's ring goes round its card
    if (this.active) {
      const picked = this.lead?.kind === "cluster" ? [this.lead.c, ...this.picked] : this.picked;
      for (const c of picked) if (S.rep[c] === c && this.clusterHasActive(c)) want.set(`c${c}`, c);
    }
    for (const i of ranked) want.set(`n${i}`, i);
    if (this.active) {
      for (const c of S.folded) {
        if (S.rep[c] === c && this.clusterHasActive(c)) want.set(`c${c}`, c);
      }
    }

    for (const [key, el] of this.cards) {
      if (!want.has(key)) {
        // the highlighted card goes away under the pointer: so does its highlight
        if (el.classList.contains("hover") && !this.pointer) this.setHover(null, 0, 0);
        el.remove();
        this.cards.delete(key);
        this.cardSize.delete(el);
      }
    }
    // place cards in priority order, each beside its declaration with a lead to it, so that the
    // point stays in sight: at the first of eight places around it that covers no card already
    // placed, no lit point and no ring of the selection. One with no such place stays a point,
    // so the canvas never shows a stack of unreadable cards.
    const grid = new BoxGrid();
    const shown = new Set<number>();
    const dotR = this.dotPx();
    this.leaders = [];
    this.clusterBoxes.clear();
    // the selection has no card, but nothing covers its rings either (drawSelection)
    for (const i of chosen) {
      if (!this.visibleNode(i)) continue;
      const lr = pickRadius(dotR, this.g.nodes[i].kind) + 4;
      const [lx, ly] = this.toScreen(this.px[i], this.py[i]);
      grid.add(lx - lr, ly - lr, lx + lr, ly + lr);
    }
    // what lies over the canvas: a card under a panel is no card
    const box0 = this.canvas.getBoundingClientRect();
    for (const r of this.ev.covers?.() ?? []) if (r.width && r.height) grid.add(r.left - box0.left, r.top - box0.top, r.right - box0.left, r.bottom - box0.top);
    // the lit points themselves
    for (const i of activeDots) {
      // an axiom's ring with it
      const pr = Math.max(3, dotR) + 2 + outside(this.g.nodes[i].kind);
      const [x, y] = this.toScreen(this.px[i], this.py[i]);
      grid.add(x - pr, y - pr, x + pr, y + pr);
    }
    const gap = Math.max(8, dotR + 9);
    for (const [key, idx] of want) {
      let el = this.cards.get(key);
      const isCluster = key[0] === "c";
      if (!el) {
        el = isCluster ? this.clusterCard(idx) : this.nodeCard(idx);
        this.cards.set(key, el);
        this.cardsEl.appendChild(el);
      }
      el.classList.toggle("pinned", !isCluster && S.isPinned(idx));
      let size = this.cardSize.get(el);
      if (!size) {
        el.style.display = "";
        size = [el.offsetWidth, el.offsetHeight];
        this.cardSize.set(el, size);
      }
      const [w, h] = size;
      const [wx, wy] = isCluster ? [S.cwx[idx], S.cwy[idx]] : [this.px[idx], this.py[idx]];
      const [sx, sy] = this.toScreen(wx, wy);
      let box: [number, number, number, number] | null = null;
      if (isCluster) {
        // a folded cluster's card sits on its body, which it stands for
        const b: [number, number, number, number] = [sx - w / 2 - 3, sy - h / 2 - 3, sx + w / 2 + 3, sy + h / 2 + 3];
        if (!grid.hits(...b)) box = b;
      } else {
        // the place it had last first, so that cards do not jump about as the view moves
        const last = this.cardSide.get(key) ?? 0;
        for (let t = 0; t < SIDES.length && !box; t++) {
          const side = t === 0 ? last : t <= last ? t - 1 : t;
          const b = besideBox(sx, sy, w, h, gap, SIDES[side]);
          if (b[0] < 0 || b[1] < 0 || b[2] > this.w || b[3] > this.h || grid.hits(b[0] - 3, b[1] - 3, b[2] + 3, b[3] + 3)) continue;
          box = b;
          this.cardSide.set(key, side);
        }
      }
      if (!box) {
        el.style.display = "none";
        continue;
      }
      el.style.display = "";
      grid.add(box[0] - 3, box[1] - 3, box[2] + 3, box[3] + 3);
      if (isCluster) {
        el.style.transform = `translate(${(sx - w / 2).toFixed(1)}px, ${(sy - h / 2).toFixed(1)}px)`;
        this.clusterBoxes.set(idx, [sx - w / 2, sy - h / 2, sx + w / 2, sy + h / 2]);
      } else {
        shown.add(idx);
        el.style.transform = `translate(${box[0].toFixed(1)}px, ${box[1].toFixed(1)}px)`;
        // the lead: from the point's edge to the nearest point of the card
        const nx = Math.min(Math.max(sx, box[0]), box[2]), ny = Math.min(Math.max(sy, box[1]), box[3]);
        const d = Math.hypot(nx - sx, ny - sy) || 1;
        const r0 = Math.max(2, dotR) + 1;
        this.leaders.push(sx + ((nx - sx) / d) * r0, sy + ((ny - sy) / d) * r0, nx, ny, idx);
      }
    }
    return shown;
  }

  private nodeCard(i: number): HTMLElement {
    const g = this.g;
    const v = g.nodes[i];
    const el = document.createElement("div");
    // its dot has its point's colour, in the scheme in force (style.css, .card.s-*); nothing else on
    // a card tells of its status
    const st = this.scheme !== "kind" ? ` ss s-${STATUSES[this.statusCode[i] ?? ST_UNREVIEWED]}` : "";
    el.className = `card ${kindDot(v.kind, g.isExt(i))}${st}${this.targetList.includes(i) ? " target" : this.keyList.includes(i) ? " key" : ""}`;
    el.dataset.node = String(i);
    // on a past graph, its marks against now: a renamed one's name now among them
    const marks = this.pastMarks?.[i] ?? 0;
    const now = this.nowNames.get(i);
    const words = marks ? markWords(marks, now ? now.split(".").pop() : undefined) : [];
    if (marks & PAST_GHOST) el.classList.add("gone");
    el.innerHTML =
      `<div class="card-head"><span class="dot"></span><span class="card-name">${escapeHtml(g.short(i))}</span>` +
      `<span class="card-kind">${g.isExt(i) ? "external" : v.kind}</span></div>` +
      (words.length ? `<div class="card-tm"${now ? ` title="${escapeHtml(now)}"` : ""}>${escapeHtml(words.join(" · "))}</div>` : "");
    return el;
  }

  private clusterCard(c: number): HTMLElement {
    const cl = this.layout.clusters[c];
    const el = document.createElement("div");
    el.className = "card cluster-card";
    el.dataset.cluster = String(c);
    const n = this.clusterActive[c];
    el.innerHTML =
      `<div class="card-head"><span class="dot"></span><span class="card-name">${escapeHtml(cl.label)}</span>` +
      `<span class="card-kind">${n} / ${cl.count}</span></div>`;
    el.title = `${cl.key} — folded; click to select it, double-click to open it, drag to move it with everything in it`;
    return el;
  }
}


/** The eight places beside a point a card can take, the most readable first: right, left, the
 *  four corners, above, below (x, y: which way from the point). */
const SIDES: [number, number][] = [[1, 0], [-1, 0], [1, -1], [1, 1], [-1, -1], [-1, 1], [0, -1], [0, 1]];

/** A card of size w × h beside the point (sx, sy), `gap` away, on `side`: [x0, y0, x1, y1]. */
function besideBox(sx: number, sy: number, w: number, h: number, gap: number, side: [number, number]): [number, number, number, number] {
  const [ax, ay] = side;
  const g = ax && ay ? gap * 0.7 : gap;
  const x0 = ax > 0 ? sx + g : ax < 0 ? sx - g - w : sx - w / 2;
  const y0 = ay > 0 ? sy + g : ay < 0 ? sy - g - h : sy - h / 2;
  return [x0, y0, x0 + w, y0 + h];
}

/** Boxes on the screen, kept in a grid of cells so that asking whether a box covers any of
 *  hundreds stays cheap every frame. */
class BoxGrid {
  private cells = new Map<number, number[]>();
  private boxes: number[] = [];
  private static CELL = 48;

  add(x0: number, y0: number, x1: number, y1: number): void {
    const k = this.boxes.length / 4;
    this.boxes.push(x0, y0, x1, y1);
    this.each(x0, y0, x1, y1, (c) => {
      const list = this.cells.get(c);
      if (list) list.push(k);
      else this.cells.set(c, [k]);
    });
  }

  hits(x0: number, y0: number, x1: number, y1: number): boolean {
    const B = this.boxes;
    let hit = false;
    this.each(x0, y0, x1, y1, (c) => {
      if (hit) return;
      for (const k of this.cells.get(c) ?? []) {
        if (x0 < B[4 * k + 2] && B[4 * k] < x1 && y0 < B[4 * k + 3] && B[4 * k + 1] < y1) {
          hit = true;
          return;
        }
      }
    });
    return hit;
  }

  private each(x0: number, y0: number, x1: number, y1: number, f: (cell: number) => void): void {
    const C = BoxGrid.CELL;
    const c0 = Math.floor(x0 / C), c1 = Math.floor(x1 / C), r0 = Math.floor(y0 / C), r1 = Math.floor(y1 / C);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) f(r * 100003 + c);
  }
}
