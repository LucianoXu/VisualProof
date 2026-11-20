// What the call is, without the page and without LiveKit (CallSpec, "The page"): where each tile goes
// in each layout, which video is received, who is the active speaker, the room's small payloads read
// with care, the People panel's order, and the words for a running time. Pure: the tests take it as
// it is (test/callmodel.test.ts), and the call (web/src/call/main.ts) only applies what it decides.
// Adapted from Cocoding's meetings (LemmaLight; CallSpec), less what VisualProof's call has not.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------- the room's own conventions

/** A raised hand is this attribute of the participant's, "1" or absent. */
export const HAND_ATTRIBUTE = "hand";
/** Reactions are data messages on this topic, `{"emoji"}`. */
export const REACTION_TOPIC = "visualproof.reaction";
export const REACTIONS = ["👍", "❤️", "😂", "🎉", "👏", "😮"] as const;
export type Reaction = (typeof REACTIONS)[number];
/** how long a reaction shows over its sender's tile */
export const REACTION_MS = 4000;

// ---------------------------------------------------------------- tiles and layouts

/** One tile: a participant's camera (its video or initials), or a presentation. */
export interface TileInfo {
  /** the participant's identity for a camera; `<identity>#screen` for a presentation */
  key: string;
  identity: string;
  kind: "camera" | "screen";
  local: boolean;
  /** when the participant joined (a camera), or the presentation started (a screen) */
  since: number;
}

export type LayoutMode = "auto" | "grid" | "speaker";
export const LAYOUTS: readonly { mode: LayoutMode; label: string; hint: string }[] = [
  { mode: "auto", label: "Auto", hint: "A presentation large and the others beside it; otherwise everyone alike" },
  { mode: "grid", label: "Grid", hint: "Everyone alike, 16 to a page" },
  { mode: "speaker", label: "Speaker", hint: "Whoever speaks large, the others beside" },
];

export interface Box {
  w: number;
  h: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** at most this many tiles on a grid page */
export const GRID_PAGE = 16;
/** the room between two tiles */
export const GAP = 8;
/** a camera's shape */
export const ASPECT = 16 / 9;
/** the key of the strip's last place when it holds more than it shows: "+N" */
export const MORE_KEY = "+more";

export const screenKey = (identity: string): string => `${identity}#screen`;

/** Tiles in the order they are shown: presentations (the newest first), the reader's own camera,
 *  then the others by when they joined. */
export function orderTiles(tiles: readonly TileInfo[]): TileInfo[] {
  const rank = (t: TileInfo) => (t.kind === "screen" ? 0 : t.local ? 1 : 2);
  return [...tiles].sort((a, b) => rank(a) - rank(b) || (a.kind === "screen" ? b.since - a.since : a.since - b.since) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export interface StageInput {
  tiles: readonly TileInfo[];
  mode: LayoutMode;
  /** the tile the reader pinned: the large one until unpinned */
  pinned: string | null;
  /** the active speaker's camera tile */
  speaker: string | null;
  /** when each tile's participant last spoke: the strip's order in Speaker */
  spoke?: ReadonlyMap<string, number>;
  /** the grid page asked for (brought within the pages there are) */
  page: number;
  box: Box;
}

export interface StageLayout {
  /** `grid`: a page of equal tiles; `focus`: one large, the others in a strip; `empty`: nothing */
  kind: "grid" | "focus" | "empty";
  focus: string | null;
  grid: string[];
  /** the strip's tiles that are shown, and those counted in its last place (+N) instead */
  strip: string[];
  more: string[];
  page: number;
  pages: number;
  side: "right" | "bottom";
  /** the place of every tile shown (and of MORE_KEY), in the stage's box */
  rects: Map<string, Rect>;
  /** the tiles shown: only their video is received */
  shown: Set<string>;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The grid that holds `n` tiles of `aspect` largest in `box`: its columns, rows and tile size. */
export function gridShape(n: number, box: Box, gap = GAP, aspect = ASPECT): { cols: number; rows: number; w: number; h: number } {
  if (n <= 0 || box.w <= 0 || box.h <= 0) return { cols: 0, rows: 0, w: 0, h: 0 };
  let best = { cols: 1, rows: n, w: -1, h: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (box.w - gap * (cols - 1)) / cols;
    const ch = (box.h - gap * (rows - 1)) / rows;
    const w = Math.max(0, Math.min(cw, ch * aspect));
    if (w > best.w + 0.01) best = { cols, rows, w, h: w / aspect };
  }
  return { cols: best.cols, rows: best.rows, w: Math.floor(best.w), h: Math.floor(best.h) };
}

/** The places of a grid of `keys` in `box`, centred, the last row centred too. */
export function gridRects(keys: readonly string[], box: Box, gap = GAP): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const { cols, rows, w, h } = gridShape(keys.length, box, gap);
  if (!cols) return out;
  const y0 = (box.h - (rows * h + (rows - 1) * gap)) / 2;
  keys.forEach((k, i) => {
    const r = Math.floor(i / cols);
    const inRow = r === rows - 1 ? keys.length - r * cols : cols;
    const x0 = (box.w - (inRow * w + (inRow - 1) * gap)) / 2;
    out.set(k, { x: Math.round(x0 + (i % cols) * (w + gap)), y: Math.round(y0 + r * (h + gap)), w, h });
  });
  return out;
}

/** The size of a strip tile, and how many the strip holds, for a stage `box` with the strip at `side`. */
export function stripShape(box: Box, side: "right" | "bottom", gap = GAP): { w: number; h: number; fits: number } {
  if (side === "right") {
    const w = Math.round(clamp(box.w * 0.2, 140, 260));
    const h = Math.round(w / ASPECT);
    return { w, h, fits: Math.max(1, Math.floor((box.h + gap) / (h + gap))) };
  }
  const h = Math.round(clamp(box.h * 0.2, 72, 150));
  const w = Math.round(h * ASPECT);
  return { w, h, fits: Math.max(1, Math.floor((box.w + gap) / (w + gap))) };
}

/** The stage's layout: Auto (a presentation large with the others in a strip; without one, the
 *  grid), Grid (16 tiles a page, paged), Speaker (the active speaker large, the others in a strip by
 *  who spoke last). A pinned tile is the large one in every layout. */
export function stageLayout(input: StageInput): StageLayout {
  const { box, pinned } = input;
  const side: "right" | "bottom" = box.w >= box.h * 1.25 ? "right" : "bottom";
  const ordered = orderTiles(input.tiles);
  const none: StageLayout = { kind: "empty", focus: null, grid: [], strip: [], more: [], page: 0, pages: 1, side, rects: new Map(), shown: new Set() };
  if (!ordered.length) return none;
  const has = (k: string | null): k is string => k !== null && ordered.some((t) => t.key === k);

  let focus: string | null = null;
  if (has(pinned)) focus = pinned;
  else if (input.mode === "auto") focus = ordered.find((t) => t.kind === "screen")?.key ?? null;
  else if (input.mode === "speaker") focus = has(input.speaker) ? input.speaker : (ordered.find((t) => t.kind === "camera" && !t.local)?.key ?? ordered[0].key);

  if (focus === null) {
    const pages = Math.max(1, Math.ceil(ordered.length / GRID_PAGE));
    const page = clamp(Math.floor(input.page) || 0, 0, pages - 1);
    const grid = ordered.slice(page * GRID_PAGE, (page + 1) * GRID_PAGE).map((t) => t.key);
    return { ...none, kind: "grid", grid, page, pages, rects: gridRects(grid, box), shown: new Set(grid) };
  }

  let rest = ordered.filter((t) => t.key !== focus);
  if (input.mode === "speaker" && input.spoke) {
    const spoke = input.spoke;
    const at = new Map(rest.map((t, i) => [t.key, i]));
    rest = [...rest].sort((a, b) => (spoke.get(b.key) ?? 0) - (spoke.get(a.key) ?? 0) || at.get(a.key)! - at.get(b.key)!);
  }
  const rects = new Map<string, Rect>();
  if (!rest.length) {
    rects.set(focus, { x: 0, y: 0, w: box.w, h: box.h });
    return { ...none, kind: "focus", focus, rects, shown: new Set([focus]) };
  }
  const s = stripShape(box, side);
  const all = rest.map((t) => t.key);
  const strip = all.length > s.fits ? all.slice(0, s.fits - 1) : all;
  const more = all.slice(strip.length);
  const places = more.length ? [...strip, MORE_KEY] : strip;
  if (side === "right") {
    rects.set(focus, { x: 0, y: 0, w: box.w - s.w - GAP, h: box.h });
    const y0 = (box.h - (places.length * s.h + (places.length - 1) * GAP)) / 2;
    places.forEach((k, i) => rects.set(k, { x: box.w - s.w, y: Math.round(y0 + i * (s.h + GAP)), w: s.w, h: s.h }));
  } else {
    rects.set(focus, { x: 0, y: 0, w: box.w, h: box.h - s.h - GAP });
    const x0 = (box.w - (places.length * s.w + (places.length - 1) * GAP)) / 2;
    places.forEach((k, i) => rects.set(k, { x: Math.round(x0 + i * (s.w + GAP)), y: box.h - s.h, w: s.w, h: s.h }));
  }
  return { ...none, kind: "focus", focus, strip, more, rects, shown: new Set([focus, ...strip]) };
}

/** The compact call's one tile: the pinned one, else the newest presentation, else the active
 *  speaker, else someone else, else the reader. */
export function compactFocus(tiles: readonly TileInfo[], pinned: string | null, speaker: string | null): string | null {
  const ordered = orderTiles(tiles);
  const has = (k: string | null): k is string => k !== null && ordered.some((t) => t.key === k);
  if (has(pinned)) return pinned;
  const screen = ordered.find((t) => t.kind === "screen");
  if (screen) return screen.key;
  if (has(speaker)) return speaker;
  return (ordered.find((t) => !t.local) ?? ordered[0])?.key ?? null;
}

/** The smallest place the full call is shown in (CallSpec decision 5): in a smaller one, the
 *  compact call. */
export const FULL_CALL: Box = { w: 640, h: 400 };
export type CallMode = "full" | "compact";
export const callMode = (size: Box): CallMode => (size.w >= FULL_CALL.w && size.h >= FULL_CALL.h ? "full" : "compact");

export interface CallFrame {
  layout: StageLayout | null;
  focus: string | null;
  rects: Map<string, Rect>;
  shown: Set<string>;
}

/** What the call shows now: out of sight (its window collapsed, the page hidden), no tile at all; the
 *  compact call, its one tile; the full call, the tiles its layout shows. */
export function callFrame(input: StageInput & { seen: boolean; call: CallMode }): CallFrame {
  if (!input.seen) return { layout: null, focus: null, rects: new Map(), shown: new Set() };
  if (input.call === "compact") {
    const focus = compactFocus(input.tiles, input.pinned, input.speaker);
    const one = focus === null ? [] : [focus];
    return { layout: null, focus, rects: gridRects(one, input.box, 0), shown: new Set(one) };
  }
  const layout = stageLayout(input);
  return { layout, focus: null, rects: layout.rects, shown: layout.shown };
}

// ---------------------------------------------------------------- the active speaker

/** how long a speaker keeps the large tile before another takes it: no flicker between two */
export const SPEAKER_HOLD_MS = 1500;

export interface Speaking {
  key: string;
  since: number;
}

/** The active speaker once the room says who speaks now (`loudest`, the loudest first; the reader
 *  left out): the loudest, unless the one before took the place less than `hold` ago; silence keeps
 *  the last one. */
export function nextSpeaker(prev: Speaking | null, loudest: readonly string[], now: number, hold = SPEAKER_HOLD_MS): Speaking | null {
  const top = loudest[0];
  if (top === undefined || prev?.key === top) return prev;
  if (prev && now - prev.since < hold) return prev;
  return { key: top, since: now };
}

// ---------------------------------------------------------------- what is received

/** A remote video track: its publication's sid and the tile it is shown in. */
export interface RemoteVideo {
  sid: string;
  tile: string;
}

/** Whether each remote video is sent at all: only where its tile is shown and the page is seen. */
export function subscriptions(videos: readonly RemoteVideo[], shown: ReadonlySet<string>, pageVisible: boolean): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const v of videos) out.set(v.sid, pageVisible && shown.has(v.tile));
  return out;
}

// ---------------------------------------------------------------- the room's payloads

const MAX_REACTION_BYTES = 256;

/** A reaction's data message: `{"emoji"}`. */
export function reactionPayload(emoji: Reaction): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify({ emoji }));
}

/** The reaction a data message carries, or null where it carries none of the six. */
export function parseReaction(payload: Uint8Array | string): Reaction | null {
  let text: string;
  if (typeof payload === "string") text = payload;
  else {
    if (payload.byteLength > MAX_REACTION_BYTES) return null;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
    } catch {
      return null;
    }
  }
  if (text.length > MAX_REACTION_BYTES) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  const emoji = isObj(v) ? v.emoji : undefined;
  return (REACTIONS as readonly unknown[]).includes(emoji) ? (emoji as Reaction) : null;
}

/** Whether a participant's attributes say its hand is raised. */
export const handRaised = (attributes: Readonly<Record<string, string>> | undefined): boolean => attributes?.[HAND_ATTRIBUTE] === "1";

// ---------------------------------------------------------------- the People panel

export interface PersonRow {
  identity: string;
  name: string;
  local: boolean;
  /** when the hand was raised, as this page saw it; null when it is not */
  hand: number | null;
}

/** The participants in the People panel's order: raised hands first, the earliest raised first;
 *  then the reader; then by name. */
export function peopleOrder<T extends PersonRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if ((a.hand === null) !== (b.hand === null)) return a.hand === null ? 1 : -1;
    if (a.hand !== null && b.hand !== null && a.hand !== b.hand) return a.hand - b.hand;
    if (a.local !== b.local) return a.local ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0);
  });
}

// ---------------------------------------------------------------- words

const pad = (n: number) => String(n).padStart(2, "0");

/** A running time: `m:ss`, or `h:mm:ss` from an hour. */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** Who is in the call, in a line: "Alice", "Alice and Bob", "Alice, Bob and 3 others". */
export function namesLine(names: readonly string[]): string {
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}
