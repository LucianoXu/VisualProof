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
import { FLAG_DASHED, FLAG_SHADED, Renderer, UNIT_DOT, UNIT_WORLD, bundle, bundlePath, circle } from "./gl/renderer.ts";
import { joinChains, pathOf } from "./bundles.ts";
import { EdgeQueue } from "./edgequeue.ts";
import type { EdgeWorker } from "./edgequeue.ts";
import { DIM, aim, blendPoints, ease, weightGap, zoomPoint } from "./overview.ts";
import type { Weighted, Weights } from "./overview.ts";
import { MODE_SITES } from "../../shared/viewgraph.ts";
import type { Graph, Mode } from "../../shared/viewgraph.ts";
import { escapeHtml } from "./highlight.ts";
import { dragKeyHeld, dragMoves, menuClick } from "./drag.ts";
import { Motion } from "./motion.ts";
import { ST_APPROVED, ST_BUILDING, ST_COMMENTED, ST_FAILED, ST_SORRY, ST_TRUSTED, ST_UNREVIEWED, STATUSES } from "./status.ts";
import type { Scheme } from "./status.ts";
import { LEAF_R, Scene } from "./scene.ts";
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
  /** its state in the Status scheme (web/src/status.ts) */
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

interface Theme {
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
  const v = (name: string) => cs.getPropertyValue(name).trim();
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

/** A colour at `k` of its opacity. */
const fade = (c: RGBA, k: number): RGBA => [c[0], c[1], c[2], c[3] * k];

const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", sans-serif`;
const CELL = 24;
const CARD_CAP = 180;
/** position ids kept past the scene's for the visitors and their temporary clusters, whose edges are
 *  bundled through them (web/src/visits.ts, visitChain) */
const VISIT_SLOTS = 256;

/** A file cluster's own build trouble, as a Status code (failed, building, sorry), or -1: what its
 *  outline shows in the Status scheme. Trouble inherited from below (blocked, out of date because
 *  something under it changed) is left out, so that one failure does not ring every file above it. */
function troubleOf(f: FileStatus | undefined): number {
  switch (f?.state) {
    case "failed":
    case "unbuilt":
      return ST_FAILED;
    case "building":
      return ST_BUILDING;
    case "sorry":
      return ST_SORRY;
    default:
      return -1;
  }
}

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
  /** each file cluster's own build trouble (troubleOf), for its outline in the Status scheme */
  private clusterTrouble = new Int8Array(0);
  private files = new Map<string, FileStatus>();
  /** how the layout on show clusters: a file's own build trouble outlines its cluster only when
   *  clusters are files (a namespace may share a module's name without being that file) */
  private clustering: ClusterMode = "namespace";
  /** how the points are coloured (setScheme): by kind, or by where each stands (CanvasSpec,
   *  "Colour schemes", decided 2026-10-08) */
  scheme: Scheme = "kind";
  /** per node, its state in the Status scheme (web/src/status.ts), from setStatus */
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
  /** edges with nothing selected: on by default, proofs off (CanvasSpec "Edges") */
  showEdges = true;
  proofEdges = false;
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

  constructor(canvas: HTMLCanvasElement, labels: HTMLCanvasElement, cardsEl: HTMLElement, g: Graph, ev: CanvasEvents) {
    this.canvas = canvas;
    this.gl = new Renderer(canvas);
    this.labels = labels;
    this.ctx = labels.getContext("2d")!;
    // layers draw in this order
    for (const [name, kind] of [["discs", "circles"], ["overview", "bundles"], ["selection", "bundles"], ["dots", "points"],
      ["rings", "points"], ["bubbles", "circles"], ["active", "points"], ["hoverC", "circles"], ["hoverP", "points"]] as const)
      this.gl.layer(name, kind);
    this.cardsEl = cardsEl;
    this.g = g;
    this.ev = ev;
    this.edgeQ = new EdgeQueue(
      () => (typeof Worker === "undefined" ? null : (new Worker("/edges.js", { type: "module" }) as unknown as EdgeWorker)),
      () => this.request(),
    );
    this.theme = readTheme();
    // light or dark changed (the reader's choice, or the system's): the colours are read again
    new MutationObserver(() => {
      this.theme = readTheme();
      this.invalidate();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    new ResizeObserver(() => this.resize()).observe(canvas);
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

  /** Which nodes are key declarations: each carries a small diamond beside its point. */
  setKeys(keys: number[]): void {
    if (keys.length === this.keyList.length && keys.every((k, j) => k === this.keyList[j])) return;
    this.keyList = keys;
    this.clearCards();
    this.invalidate();
  }

  isKey(i: number): boolean {
    return this.keyList.includes(i);
  }

  /** Where each node of the canvas's graph stands (web/src/status.ts, statusCodes): its colour in
   *  the Status scheme, and the clusters' progress. */
  setStatus(codes: Uint8Array): void {
    this.statusCode = codes.length === this.g.n ? codes : new Uint8Array(this.g.n).fill(ST_UNREVIEWED);
    this.countProgress();
    if (this.scheme === "status") this.clearCards();
    this.invalidate();
  }

  /** Colour the points by kind or by status. Rings, the target's star and the others' marks are
   *  the same in both. */
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
    this.clusterTrouble = new Int8Array(this.layout.clusters.length);
    // in the file layout a cluster is a module (or a directory of them); under namespaces a
    // cluster's key is a namespace, which can read like a module's name without being its file
    if (this.clustering !== "module") return;
    this.layout.clusters.forEach((c, k) => (this.clusterTrouble[k] = troubleOf(this.files.get(c.key))));
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

  /** Whether declaration `i` is drawn as itself now (not folded away, not a hidden outside one):
   *  what an artwork draws (web/src/artwork.ts). */
  isNodeShown(i: number): boolean {
    return this.visibleNode(i);
  }

  /** A declaration's point on the screen, in pixels, at the zoom now. */
  get dotSize(): number {
    return this.dotPx();
  }

  /** The graph the board is drawn from (its numbering). */
  get graph(): Graph {
    return this.g;
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
    // the theme's colours are read again (an edge's colours are the theme's, the same in every mode)
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

  setEdges(show: boolean, proofs: boolean): void {
    this.showEdges = show;
    this.proofEdges = proofs;
    this.request();
  }

  setShowExternals(on: boolean): void {
    this.showExternals = on;
    this.countProgress();
    this.rebuildGrid();
    this.invalidate();
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

  /** Frame the whole board in a rectangle of the screen (an artwork's frame, web/src/artframe.ts):
   *  its top-level circles and declarations, at once. */
  fitRect(rect: { x: number; y: number; w: number; h: number }): void {
    const S = this.scene;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of S.rootC) {
      if (!this.clusterVisible(c)) continue;
      const r = S.drawnR[c];
      [x0, y0, x1, y1] = [Math.min(x0, S.cwx[c] - r), Math.min(y0, S.cwy[c] - r), Math.max(x1, S.cwx[c] + r), Math.max(y1, S.cwy[c] + r)];
    }
    for (const i of S.rootN) [x0, y0, x1, y1] = [Math.min(x0, this.px[i] - 8), Math.min(y0, this.py[i] - 8), Math.max(x1, this.px[i] + 8), Math.max(y1, this.py[i] + 8)];
    if (!isFinite(x0)) return;
    const k = Math.min(ZOOM_MOST, Math.min(rect.w / (x1 - x0), rect.h / (y1 - y0)) * 0.94);
    // the board's middle at the rectangle's
    this.jumpTo({ x: (x0 + x1) / 2 - (rect.x + rect.w / 2 - this.w / 2) / k, y: (y0 + y1) / 2 - (rect.y + rect.h / 2 - this.h / 2) / k, k });
  }

  /** Put the camera at `cam` at once, ending any motion in progress, which would carry it off: a
   *  share link's region, framed (shared/sharesnap.ts). */
  jumpTo(cam: { x: number; y: number; k: number }): void {
    if (this.anim) cancelAnimationFrame(this.anim);
    this.anim = this.camGoal = null;
    this.cam = { ...cam };
    this.request();
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
    for (let c = 0; c < S.nc; c++) {
      if (S.rep[c] >= 0 || !this.clusterVisible(c)) continue;
      const t = byStatus ? this.clusterTrouble[c] ?? -1 : -1;
      if (t < 0) circle(discs, S.cwx[c], S.cwy[c], S.drawnR[c], UNIT_WORLD, th.disc, th.discLine, 1);
      else circle(discs, S.cwx[c], S.cwy[c], S.drawnR[c], UNIT_WORLD, th.disc, th.status[t], 1.5);
    }
    for (let c = 0; c < S.nc; c++) {
      if (S.rep[c] !== c || !this.clusterVisible(c)) continue;
      const lit = act !== null && this.clusterHasActive(c);
      const base = lit ? th.lit : th.discLine;
      const fill: RGBA = [base[0], base[1], base[2], lit ? 1 : Math.min(1, base[3] * 3 + 0.15) * (act ? 0.5 : 1)];
      circle(bubbles, S.cwx[c], S.cwy[c], S.drawnR[c], UNIT_WORLD, fill, null, 0, FLAG_SHADED, 0, 6);
    }
    this.tempDiscs(discs);

    // edges of the selection, bundled along the tree, on top of the overview
    const sel = g.layer("selection", "bundles");
    sel.clear();
    if (act && this.edges.length) {
      const count = this.edges.length / 3;
      const fade = count < 250 ? 1 : Math.max(0.25, Math.sqrt(250 / count));
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
        const c0: RGBA = [th.edgeFrom[0], th.edgeFrom[1], th.edgeFrom[2], th.edgeFrom[3] * f];
        const c1: RGBA = [th.edgeTo[0], th.edgeTo[1], th.edgeTo[2], th.edgeTo[3] * f];
        bundle(sel, pathOf(S, a, b), 0.85, width, c0, c1);
      }
    }
    this.visitBundles(sel);

    // points: dots for declarations, rings for the world outside the project, in the scheme's
    // colours; what is lit is drawn over them in draw()
    const dim = act ? 0.22 : 0.9;
    for (let i = 0; i < this.g.n; i++) {
      if (!this.visibleNode(i) || (act && act[i])) continue;
      this.point(dots, i, dim, false);
    }
    // a pinned point carries a thin ring: where it is was chosen by hand. Nothing else rings a
    // point but a past graph's marks; status is the Status scheme's (decided 2026-10-08)
    for (let i = 0; i < this.g.n; i++) {
      if (this.visibleNode(i) && S.isPinned(i)) circle(rings, this.px[i], this.py[i], 1, UNIT_DOT, [0, 0, 0, 0], th.pin, 1, 0, 2.5);
    }
    // on a past graph, what changed since and what was renamed since have a ring of their own
    const M = this.pastMarks;
    if (M)
      for (let i = 0; i < this.g.n; i++) {
        if (!(M[i] & (PAST_CHANGED | PAST_RENAMED)) || !this.visibleNode(i)) continue;
        const faded = act && !act[i] ? 0.45 : 1;
        if (M[i] & PAST_CHANGED) circle(rings, this.px[i], this.py[i], 1, UNIT_DOT, [0, 0, 0, 0], fade(th.tmChanged, faded), 1.6, 0, 2.2);
        // a rename is the lighter news: its ring is thinner and fainter than a change's
        if (M[i] & PAST_RENAMED) circle(rings, this.px[i], this.py[i], 1, UNIT_DOT, [0, 0, 0, 0], fade(th.tmRenamed, 0.7 * faded), 1.1, 0, M[i] & PAST_CHANGED ? 4.4 : 2.2);
      }
  }

  /** A node's colour in the scheme in force. */
  private colorOf(i: number): RGBA {
    const th = this.theme;
    if (this.scheme === "status") return th.status[this.statusCode[i] ?? ST_UNREVIEWED];
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
    if (lit) {
      circle(L, x, y, 1.4, UNIT_DOT, c, this.theme.bg, 1.5, 0, 0.75);
      if (m & PAST_GHOST) circle(L, x, y, 1.4, UNIT_DOT, [0, 0, 0, 0], this.theme.tmGone, 1.3, 0, 2.6);
      return;
    }
    if (m & PAST_GHOST) {
      circle(L, x, y, 1, UNIT_DOT, a(0.28 * alpha), fade(this.theme.tmGone, alpha), 1.5, 0, -0.4);
      return;
    }
    if (this.g.isExt(i)) circle(L, x, y, 0.8, UNIT_DOT, [0, 0, 0, 0], a(alpha), 1.3, 0, -0.6);
    else circle(L, x, y, 1, UNIT_DOT, a(alpha));
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
    if (!this.showEdges) {
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
    const base = `${this.sceneSerial}|${S.repVersion}|${this.showExternals}|${this.proofEdges}`;
    if (base !== this.overviewBase) {
      // what was drawn stays until the new points come (after a fold, a toggle), unless it is of
      // another scene, whose clusters it names
      if (!this.overviewBase.startsWith(`${this.sceneSerial}|`)) L.clear();
      this.overviewBase = base;
      Q.setBase(S, { externals: this.showExternals, proofs: this.proofEdges });
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
    const drawn = `${this.overviewStyle}|${dim}|${W.map((x) => `${Q.points.get(x.point)!.serial}:${x.w.toFixed(3)}`).join(",")}`;
    if (drawn === this.overviewDrawn) return;
    this.overviewDrawn = drawn;
    const from = this.theme.edgeFrom, to = this.theme.edgeTo;
    const c0: RGBA = [from[0], from[1], from[2], 0], c1: RGBA = [to[0], to[1], to[2], 0];
    L.clear();
    blendPoints(sets, (P, j, beta, width, alpha) => {
      // from the part that uses to the part it uses
      c0[3] = alpha;
      c1[3] = alpha;
      bundlePath(L, P.path, 8 * j, P.len[j], beta, width, c0, c1);
    });
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
    if (!t || t.kind === "visitor") return;
    const a = th.lit;
    if (t.kind === "cluster") {
      if (S.rep[t.c] >= 0 && S.rep[t.c] !== t.c) return;
      const shut = S.rep[t.c] === t.c;
      circle(C, S.cwx[t.c], S.cwy[t.c], S.drawnR[t.c], UNIT_WORLD, [a[0], a[1], a[2], shut ? 0 : 0.05], [a[0], a[1], a[2], 0.9], 2, 0, shut ? 3 : 0, 6);
    } else if (this.visibleNode(t.i)) {
      circle(P, this.px[t.i], this.py[t.i], 1, UNIT_DOT, [0, 0, 0, 0], [a[0], a[1], a[2], 0.95], 2, 0, 3.5);
    }
  }

  /** Text: cluster labels, labels of folded clusters, names up close. */
  private drawLabels(onScreen: (sx: number, sy: number, pad: number) => boolean, dotR: number): void {
    const ctx = this.ctx;
    const k = this.cam.k;
    const th = this.theme;
    const S = this.scene;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
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
    const place = (text: string, cx: number, baseline: number, size: number): boolean => {
      const w = ctx.measureText(text).width / 2 + 3;
      const x0 = cx - w, x1 = cx + w, y0 = baseline - size, y1 = baseline + size * 0.3;
      if (!free(x0, y0, x1, y1)) return false;
      take(x0, y0, x1, y1);
      ctx.fillText(text, cx, baseline);
      labels.push(...this.toWorld(x0, y0), ...this.toWorld(x1, y1));
      return true;
    };
    ctx.fillStyle = th.label;
    for (let c = 0; c < S.nc; c++) {
      const rep = S.rep[c];
      if (!this.clusterVisible(c)) continue;
      const cl = this.layout.clusters[c];
      const [sx, sy] = this.toScreen(S.cwx[c], S.cwy[c]);
      if (rep === c) {
        const r = Math.max(6, S.drawnR[c] * k);
        if (r > 10 && onScreen(sx, sy, r) && !(act && this.clusterHasActive(c))) {
          ctx.font = `500 11px ${FONT}`;
          place(cl.label, sx, sy + r + 13, 11);
        }
        continue;
      }
      if (rep >= 0) continue;
      const sr = S.drawnR[c] * k;
      if (sr <= 38 || !onScreen(sx, sy, sr)) continue;
      const size = Math.max(10, Math.min(20, 9 + sr / 40));
      ctx.font = `${cl.depth === 0 ? 600 : 500} ${size}px ${FONT}`;
      // covered at the top: one line lower, still inside its own circle
      if (place(cl.label, sx, sy - sr + size + 6, size) || (sr > 4 * size && place(cl.label, sx, sy - sr + 2 * size + 10, size))) named.set(c, labels.length - 4);
    }
    this.tempLabels(place, onScreen);
    this.labelBoxes = labels;
    this.labelOfC = named;
    this.drawProgress(onScreen);
    this.drawLeaders();
    this.drawKeys(onScreen, dotR);
    this.drawStars(onScreen, dotR);
    this.drawVisitors(onScreen);
    this.drawPeers(onScreen, dotR);
    this.drawSelection(dotR);
    if (k > 1.1 && !act) {
      ctx.font = `11px ${FONT}`;
      ctx.textAlign = "left";
      ctx.fillStyle = th.text;
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
        const [sx, sy] = this.toScreen(this.px[i], this.py[i]);
        let w = this.nameW[i];
        if (!(w >= 0)) w = this.nameW[i] = ctx.measureText(this.g.short(i)).width;
        const x0 = sx + dotR + 2, y0 = sy - 7, x1 = x0 + w + 2, y1 = sy + 5;
        if (!free(x0, y0, x1, y1)) continue;
        take(x0, y0, x1, y1);
        ctx.fillText(this.g.short(i), sx + dotR + 3, sy + 3.5);
        budget--;
      }
    }
  }

  /** In the Status scheme, how far the review of each cluster on screen has come, on its outline: an
   *  arc from the top, clockwise, for the share approved, then one for the share commented, of what
   *  it holds that needs review. Only on circles large enough to read it, and only where something
   *  has been said. */
  private drawProgress(onScreen: (sx: number, sy: number, pad: number) => boolean): void {
    if (this.scheme !== "status" || !this.clusterProgress.length) return;
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
    if (!this.targetList.length) return;
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
    for (const i of this.targetList) {
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
   *  on the edge of its disc, opposite the star's place. Never smaller than can be seen. */
  private drawKeys(onScreen: (sx: number, sy: number, pad: number) => boolean, dotR: number): void {
    if (!this.keyList.length) return;
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
    for (const i of this.keyList) {
      if (this.visibleNode(i)) {
        const [sx, sy] = this.toScreen(this.px[i], this.py[i]);
        if (onScreen(sx, sy, 12)) diamond(sx - dotR - R * 0.4, sy - dotR - R * 0.3, R);
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
        if (onScreen(sx, sy, 30)) mark(sx, sy, Math.max(7, dotR + 4), m);
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
      const c = this.scheme === "status" ? th.status[v.status] ?? th.status[ST_UNREVIEWED] : v.kind === "external" ? th.ext : th.kind[v.kind] ?? th.ext;
      ctx.fillStyle = css(th.bg);
      ctx.beginPath();
      ctx.arc(x, y, R + 3, 0, 2 * Math.PI);
      ctx.fill();
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
        return [x, y, dotR + 4, -1 - i];
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
    const pointR = Math.max(7, dotR + 4);
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
        return { x, y, r: this.visitorR() + 5 };
      }
      if (t.kind === "node") {
        if (t.i < 0 || t.i >= this.g.n) return null;
        if (!this.visibleNode(t.i)) return S.nodeRep[t.i] < 0 ? null : body(S.nodeRep[t.i]);
        const [x, y] = this.toScreen(this.px[t.i], this.py[t.i]);
        return { x, y, r: pointR };
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
    const lead = this.lead && markOf(this.lead);
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
    const k = this.cam.k;
    const S = this.scene;
    // what is selected has no card: a ring says where it is (drawSelection)
    const chosen = new Set(this.focus);
    if (this.lead?.kind === "node") chosen.add(this.lead.i);
    // which active nodes get a card: the nearest to the screen centre
    const cx = this.w / 2;
    const cy = this.h / 2;
    const cap = k < 0.12 ? 0 : k < 0.35 ? 40 : k < 0.8 ? 90 : CARD_CAP;
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
    const lr = Math.max(7, dotR + 4) + 4;
    for (const i of chosen) {
      if (!this.visibleNode(i)) continue;
      const [lx, ly] = this.toScreen(this.px[i], this.py[i]);
      grid.add(lx - lr, ly - lr, lx + lr, ly + lr);
    }
    // what lies over the canvas: a card under a panel is no card
    const box0 = this.canvas.getBoundingClientRect();
    for (const r of this.ev.covers?.() ?? []) if (r.width && r.height) grid.add(r.left - box0.left, r.top - box0.top, r.right - box0.left, r.bottom - box0.top);
    // the lit points themselves
    const pr = Math.max(3, dotR) + 2;
    for (const i of activeDots) {
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
    const st = this.scheme === "status" ? ` ss s-${STATUSES[this.statusCode[i] ?? ST_UNREVIEWED]}` : "";
    el.className = `card k-${g.isExt(i) ? "external" : v.kind}${st}${this.targetList.includes(i) ? " target" : this.keyList.includes(i) ? " key" : ""}`;
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
