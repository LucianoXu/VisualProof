// The notes on the board on show (CanvasSpec "Notes", ViewSpec decision 23, AttachmentSpec decisions
// 13–19), drawn over the canvas as elements of the page: their text is real text at a fixed size on
// the screen, in the page's font, whatever the zoom. Two kinds share the layer:
//
// - the project's notes (shared/projectnotes.ts), items that belong to views as declarations do (the
//   owner's decision of 2026-10-11): every one on the Project, and on another board those that follow
//   from its scope and those added to its view, less those taken out (shared/noteplace.ts, itemWhy).
//   Each is in its cluster under the board's clustering, at its spot of the circle as a fraction of
//   the radius drawn, or on the ring around the board (shared/ring.ts) — where its cluster is not
//   drawn, or at the top level — at the angle where it was let go, else toward what it carries a file
//   linked to on this board, else at the angle of the centre on this board of the declarations of
//   its cluster under the other clustering;
// - the view's own notes (shared/sticky.ts), drawn apart — a dashed ring and edge, and the view's
//   name — where they always were under their own clustering, and on the ring under the other.
//
// Which boards show a note, and where, is shared/noteplace.ts's; each note is placed again every
// frame the canvas draws. Notes on the ring keep their order and a fixed gap on the screen between
// them; those one ring cannot hold so at the zoom go on rings further out, concentric with it
// (shared/ring.ts, packRings).
//
// A note of either kind may be attached to a declaration instead (the owner's decisions of 2026-10-12):
// its icon then sits near the declaration's point, at the note's own offset in the board's units — a
// place on the board, as a node's is, so that it comes closer on the screen as the zoom goes out —,
// joined to it by a thin dashed leader ending in a small diamond on the point's rim, under every
// clustering and wherever the board holds the declaration (a reader's visitor counts).
//
// A note is a small round icon at its place (the owner's decision, 2026-10-11; shared/notecard.ts),
// which says what it carries and nothing else: a note for nothing, an image for images alone, a paper
// for a PDF or a clip, with a count where it carries more than one thing. Expanded, its card — its
// text (a little Markdown, and full names in backticks as links that go there), what it carries
// (AttachmentSpec decision 12) and who wrote it — hangs from the icon on a thin leader line, at the
// note's own offset, kept in pixels of the screen and shared, or by default up and to the right
// (outward on the ring), flipped to stay on the screen and, by default, off its cluster's name.
// Collapsed, the icon alone. A click on the icon toggles which, for everyone. Icons scale with what
// they belong to (the owner's decisions of 2026-10-12): a note in a cluster, or attached to a
// declaration, is its icon only while its cluster — the one that holds its declaration, for an
// attached note — is large enough on the screen to hold a card; below that it is a dot the size of a
// declaration's point, coloured by what it carries, blended into its icon over a short range of
// zoom, and a click on the dot brings the view near enough to read it. Its card shows only while its
// icon does. On the ring an icon keeps its size, its card hidden while the rings are small on the
// screen, and a click on it then brings the view near enough. A note in a folded cluster is hidden,
// and the outermost folded cluster around it carries a marker with how many it holds. An expanded
// note's card covers the icons and dots under it, the one pressed or opened last in front of the
// other cards (shared/notecard.ts, NOTE_Z); the icon being dragged is over everything.
//
// A drag moves things only as a drag moves a declaration: with the lock let go, or the drag key (⌘ on
// a Mac, Ctrl elsewhere) held (web/src/drag.ts); otherwise it pans the view, as a drag on the canvas
// does, and a drag on a dot always pans. A drag on the icon moves the note — what would hold it lit
// meanwhile: the declaration under it, which wins over the cluster around it, its cluster or the ring
// — and let go on a declaration it is attached to it, beside the point on the side it was let go.
// While an attached note's icon is dragged, a dashed circle is drawn round its declaration, held
// between 48 and 160 px on the screen whatever the zoom (the owner's decision of 2026-10-12): let go
// inside it, the note stays attached there at that offset; out of it, the note is dragged as a free
// note is, and another declaration under it takes it wherever it is. Let go in a cluster's free
// space, a project note takes its place there under the board's clustering; let go where no cluster
// is, it goes on the ring at that angle; a view note let go there stays at that spot of the board. A
// drag on the card moves the card alone, never the note's place. A double-click on the card edits the
// note, a right click on either opens its menu. What a note's changes do is web/src/main.ts's: they go
// out as operations, the view's or the project's notes'.

import type { ClusterMode, Layout, ViewNode } from "../../shared/graph.ts";
import { parseSubject } from "../../shared/library.ts";
import type { FileRecord } from "../../shared/library.ts";
import { cardZ, carryCount, clearOfIcon, declDrop, declLeader, declsPointable, declSpot, defaultCard, dropTarget, hangCard, ICON_PX, ICON_R, iconKind, iconShare, keptCard, leaderLine, levelOf, markClick, markLook, markR, noteBoxes, pointPx, raiseCard, ringCard, zonePx } from "../../shared/notecard.ts";
import type { Box, DropTarget, FitNote, IconKind, NoteLevel } from "../../shared/notecard.ts";
import { aboutMembers, besidePlace, declPlace, existsIn, itemSpot, itemWhy, linkedOn, linksByFile, noteBoard, otherMode, placeIn, spacedPlaces, spotIn, thenNames, viewSpot } from "../../shared/noteplace.ts";
import type { About, ItemWhy, NoteBoard, NoteSpot } from "../../shared/noteplace.ts";
import type { ViewItems } from "../../shared/items.ts";
import type { ClusterPlace, ProjectNote } from "../../shared/projectnotes.ts";
import { aboutAngle, angleOf, packRings, ringAround, ringRadians, RING_STEP_PX } from "../../shared/ring.ts";
import { shortName } from "../../shared/viewgraph.ts";
import type { FitBox, Ring, RingItem } from "../../shared/ring.ts";
import { AUTO_COLLAPSE_PX, noteExcerpt, noteLook, noteMarkers, placeAt, placeIn as viewPlaceIn } from "../../shared/sticky.ts";
import type { NoteCard, NoteCarry, NoteDecl, NotePlace, PlaceCluster, StickyNote } from "../../shared/sticky.ts";
import { firstWords } from "../../shared/doc/outline.ts";
import { BOT } from "./agentmark.ts";
import type { GraphCanvas } from "./canvas.ts";
import { dragKeyHeld, MAC, menuClick } from "./drag.ts";
import { escapeHtml } from "./highlight.ts";
import { renderMarkdown } from "./markdown.ts";
import { nameHtml } from "./verified.ts";
import { composing } from "./ime.ts";

/** a press becomes a drag after this much movement, as on the canvas */
const DRAG_PX = 6;
/** the most declarations of what a note on the ring is about that are read for its angle */
const ABOUT_MOST = 4000;
/** a cluster's radius on the screen from which it can be pointed at, as the canvas's highlight has
 *  it (web/src/canvas.ts, CLUSTER_MIN_PX) */
const SEEN_PX = 20;
/** how far beside a declaration's point a note put there goes, up and to the right, in pixels of
 *  the screen: its icon just clear of the point */
const BESIDE_PX = 18;
/** the same in the Project's layout at rest, in its units, for where a note attached to a declaration
 *  falls back to under the clustering the board is not shown by (a point's radius is 5) */
const BESIDE_UNITS: [number, number] = [9, -9];
/** the width of an attached note's dashed leader at its icon's full size, in pixels: it scales as the
 *  icon does (web/style.css, .sk-dlead) */
const DLEAD_PX = 1.5;
/** the least radius on the screen a dot answers the pointer within, in pixels: a dot is as small as a
 *  declaration's point, too small to hit by itself */
const DOT_HIT_PX = 4;
/** how often the centre of what a note on the ring is about is read again, in ms */
const CENTRE_MS = 200;
/** how far off the screen a note's icon may be and still be drawn, in pixels: its card may reach in */
const OFF_PX = 40;
/** the room a card keeps from the edges of what the bars and panels leave of the screen */
const ROOM_PAD = 6;
/** how much of a scrolling note text's right edge is its scrollbar where the bar is drawn over the
 *  text and takes no room of its own (macOS shows it so): a press there is the bar's */
const OVERLAY_BAR_PX = 12;

/** A box that may scroll, as the wheel and a press read it. */
export interface ScrollBox {
  scrollHeight: number;
  clientHeight: number;
  clientWidth: number;
  offsetWidth: number;
}

/** Whether a note's text is longer than its card shows (`.sk-text`, 260 px at most), so that it
 *  scrolls. */
export function scrolls(text: ScrollBox | null): boolean {
  return !!text && text.scrollHeight - text.clientHeight > 1;
}

/** Where the wheel over a note goes (the owner's decision of 2026-10-12): to its text, which scrolls,
 *  where the pointer is on a text that scrolls — at its ends too, never falling through to the canvas,
 *  so that a flick that reaches the end does not turn into a zoom; to the canvas, which zooms,
 *  anywhere else on a note, and anywhere with Ctrl, which is a trackpad's pinch. */
export function wheelGoes(text: ScrollBox | null, ctrl: boolean): "text" | "canvas" {
  return !ctrl && scrolls(text) ? "text" : "canvas";
}

/** Whether a press on a note's text is the text's, not the card's (which pans the canvas, or moves
 *  the card): on a text that scrolls, a finger or a pen anywhere, which scrolls it as the browser
 *  does, and a mouse on its scrollbar, `fromRight` pixels from the text's right edge — as wide as the
 *  bar is, or, where it is drawn over the text, its last OVERLAY_BAR_PX. */
export function textPress(text: ScrollBox, pointerType: string, fromRight: number): boolean {
  if (!scrolls(text)) return false;
  if (pointerType !== "mouse") return true;
  return fromRight >= 0 && fromRight < Math.max(text.offsetWidth - text.clientWidth, OVERLAY_BAR_PX);
}

/** A card's width while its note carries something, in pixels of the screen: its attachments
 *  are at the card's width — the wider where it carries an image or a clip, something to look at,
 *  the narrower where it carries whole PDFs alone, each a small first page beside its title. */
export const CARRY_W = { picture: 320, paper: 260 };
/** the room inside a card, its padding taken off */
const INNER_PAD = 22;
/** a whole PDF's first page as a note shows it, in pixels of the screen */
const PAGE_W = 64;
/** the widths the server draws a page or a clip at (server/poppler.ts): a note asks for the first
 *  that is at least what the screen shows, at its pixel ratio, so that one drawing serves every note
 *  of that size and the browser keeps it */
const DRAWN_W = [400, 800, 1200, 1600, 2000];
const drawnWidth = (cssPx: number): number => {
  const want = cssPx * Math.min(window.devicePixelRatio || 1, 3);
  return DRAWN_W.find((w) => w >= want) ?? DRAWN_W[DRAWN_W.length - 1];
};

export const NOTE_ICON =
  `<svg class="sk-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h10v7.5l-3.5 3.5H3z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>` +
  `<path d="M9.5 13.5V10H13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5.2 5.5h5.6M5.2 7.8h3.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;

/** A note that carries images alone: a picture. */
const IMAGE_ICON =
  `<svg class="sk-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.2" y="3" width="11.6" height="10" rx="1.6" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.3"/>` +
  `<circle cx="5.9" cy="6.4" r="1.25" fill="currentColor"/><path d="M2.9 12.1 6.5 8.6l2.4 2.3 1.7-1.6 2.6 2.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** A note that carries a PDF or a clip of one: a page, its corner turned. */
const PAPER_ICON =
  `<svg class="sk-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.8 1.9h5.5l2.9 2.9v9.3H3.8z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>` +
  `<path d="M9.2 2v3h3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5.8 7.6h4.4M5.8 9.7h4.4M5.8 11.8h2.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;

/** A view's mark on its own notes: a tab, as the views' tabs are. */
export const VIEW_MARK =
  `<svg class="sk-view" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13.5V5.5h4.2l1-2.5h5.3a1.5 1.5 0 0 1 1.5 1.5v9z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;

/** Each kind of icon drawn: a note, a picture, a page. */
const ICONS: Record<IconKind, string> = {
  note: NOTE_ICON,
  image: IMAGE_ICON,
  paper: PAPER_ICON,
};

export type NoteKind = "project" | "view";

/** Where a note goes when it is put at a spot of the board: a project note's place under the
 *  board's clustering, or a view note's place. */
export type PlaceFor = { kind: "project"; mode: ClusterMode; place: ClusterPlace } | { kind: "view"; place: NotePlace };

/** Where a note whose icon is let go goes (the owner's decision of 2026-10-12): attached to a
 *  declaration (`decl`), its place then being where it falls back to — beside the declaration under
 *  the board's clustering (`to`; null leaves it as it is), and, where it is attached afresh, under the
 *  other too (`also`, a note of the project's) — or detached (`decl` null) and placed at `to`. */
export interface Dropped {
  decl: NoteDecl | null;
  to: PlaceFor | null;
  also?: { mode: ClusterMode; place: ClusterPlace };
}

export interface StickyHooks {
  /** the notes of the board on show: every note of the project (the layer decides which the board
   *  shows), and the view's own */
  notes(): { project: ProjectNote[]; view: StickyNote[] };
  /** what the board on show holds of the project's notes besides what its scope gives: everything
   *  (`all`, the Project), else its view's lists; and the library's links as the board reads them
   *  (a past build's under its names then), which bring a note that carries a linked file */
  items(): { all: boolean; items?: ViewItems; links: readonly { subject: string; file: string }[] };
  /** the board on show: its declarations in the canvas's numbering, those of the whole graph it is
   *  of (whether a cluster is still one: a past build's on a board of a past build), its clustering,
   *  and on a board of a past build its renames (PastGraph.nowName: each declaration's name then to
   *  its name now), by which a note's attachment, which names a declaration now, is read there */
  board(): { nodes: ViewNode[]; full: ViewNode[]; mode: ClusterMode; nowName?: ReadonlyMap<string, string> } | null;
  /** the reader's visitors on the board on show, by name, in the canvas's order (setVisitors): a
   *  note attached to one shows there */
  visitors(): readonly string[];
  /** the Project's layout by `mode` at rest — the server's — with the latest build's declarations by
   *  name: where a note attached on this board falls back to under the clustering the board is not
   *  shown by; null where there is none */
  whole(mode: ClusterMode): { L: Layout; index: ReadonlyMap<string, number> } | null;
  /** a name written in a note as the declaration it links to, or null */
  resolve(name: string): string | null;
  go(name: string): void;
  /** whether a drag on a note moves it, with the drag key held at the press or not */
  moves(held: boolean): boolean;
  /** a note opened or collapsed by a click on its icon: its own state, for everyone */
  setOpen(id: string, kind: NoteKind, open: boolean): void;
  /** a note let go: attached to a declaration, or at a new place */
  moved(id: string, to: Dropped): void;
  /** a note's card let go at a new offset from its icon: shared, as its state is */
  card(id: string, kind: NoteKind, card: NoteCard): void;
  /** a double-click on a note's card */
  edit(id: string): void;
  /** a right click on a note, at a point of the window */
  menu(id: string, x: number, y: number): void;
  /** a folded cluster's marker clicked: the cluster opened, for everyone */
  unfold(c: number): void;
  /** the library's record of a file a note carries, or null where it has none */
  file(sha: string): FileRecord | null;
  /** one of the files or clips a note carries clicked: opened in the reference window */
  openCarry(id: string, c: NoteCarry): void;
}

interface Drawn {
  kind: NoteKind;
  note: ProjectNote | StickyNote;
  /** the note's element, holding its icon, its leader and its card, each placed on the layer */
  el: HTMLElement;
  icon: HTMLElement;
  lead: HTMLElement;
  card: HTMLElement;
  /** attached to a declaration: the dashed leader to its point, and the diamond on the point's rim */
  dlead: HTMLElement;
  dmark: HTMLElement;
  /** where it is on the board on show */
  spot: NoteSpot;
  /** why the board shows it, for a note of the project (shared/noteplace.ts, itemWhy); null for a
   *  view's own */
  why: ItemWhy | null;
  /** on the ring: the declarations of the board it is about, which give its angle */
  about: number[];
  /** how it showed in the last frame: its icon and card, its icon alone (collapsed, by its state or
   *  by the zoom), or hidden */
  look: "open" | "shut" | "hidden";
  /** how much of its icon showed in the last frame, from 0 (its dot) to 1 (its icon: shared/notecard.ts,
   *  iconShare); what it was drawn at, to write its style only when that changes */
  t: number;
  drawnAt: string;
  /** its card's size as last measured, which the ring spaces notes by and framing the board reads
   *  for a zoom it is not at yet; null till it is measured again */
  cardSize: [number, number] | null;
  /** where its icon is drawn now: in the board's world and on the screen (null while hidden) */
  world: [number, number] | null;
  at: [number, number] | null;
  /** its card's box on the screen now, null while it shows none */
  box: Box | null;
  /** on the ring, its angle in the last frame (radians) */
  angle: number | null;
  /** on the ring, the centre of what it is about as last read, and when (read again a few times a
   *  second, not every frame: thousands of declarations move only while the board moves) */
  centre: [number, number] | null;
  centreAt: number;
}

/** What a note on the ring is about, in a few words: the declarations and clusters a file it carries
 *  is linked to on this board, by their last parts, or its cluster under the other clustering. */
function aboutWords(about: NonNullable<About>): string {
  if ("key" in about) return `about ${about.mode === "module" ? "the folder" : "the namespace"} ${about.key.replace("⟨external⟩", "External")}`;
  const names = about.links.map((subject) => {
    const s = parseSubject(subject);
    if (!s) return subject;
    const last = s.name.split(".").pop() ?? s.name;
    return s.kind === "decl" ? last : s.kind === "ns" ? `the namespace ${last}` : `the folder ${last}`;
  });
  return `linked to ${names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ")}`;
}

/** A press on a note, until it is let go: on its icon (a click toggles it, a drag moves the note) or
 *  on its card (a drag moves the card); where the icon or the card was on the screen then (`at`: the
 *  icon's centre, the card's top left corner); `att`, the attachment it is on, which a click opens. */
interface Press {
  id: string;
  part: "icon" | "card";
  /** pressed on its dot (or an icon turning into one): a click flies to it, a drag pans */
  dot: boolean;
  x: number;
  y: number;
  moves: boolean;
  moved: boolean;
  cam: { x: number; y: number };
  at: [number, number];
  /** where what is dragged is on the screen now, as `at` says it; null till it is dragged */
  now: [number, number] | null;
  att: number | null;
  /** a Mac's Ctrl+click: let go where it was pressed, it is the note's menu's, not a click */
  menu: boolean;
}

/** The circle round the declaration a dragged note is attached to (the owner's decision of 2026-10-12):
 *  its declaration's point in the world, its short name, and whether the icon is inside — where,
 *  let go, the note stays attached. */
interface Zone {
  point: [number, number];
  label: string;
  inside: boolean;
}

export class Stickies {
  private layer: HTMLElement;
  private canvas: GraphCanvas;
  private hooks: StickyHooks;
  private drawn = new Map<string, Drawn>();
  /** the notes were placed again (one written, moved, taken out, another board): told after */
  onRender: (() => void) | null = null;
  private markers = new Map<number, HTMLElement>();
  /** the layout the notes were placed on: another one places them again */
  private layoutSeen: unknown = null;
  /** the board as notes read it, and what it was read from */
  private nb: NoteBoard | null = null;
  private nbOf: { L: Layout | null; nodes: ViewNode[] | null; mode: ClusterMode | null } = { L: null, nodes: null, mode: null };
  /** the ring around the board, as drawn in the last frame */
  ring: Ring | null = null;
  /** what would hold the note whose icon is dragged, were it let go now */
  private target: DropTarget = null;
  /** the circle round its declaration, while the icon of a note attached to one is dragged */
  private zone: Zone | null = null;
  /** the cluster of each key of the layout on show, and the layout it was read from */
  private indexOf: { L: Layout | null; map: Map<string, number> } = { L: null, map: new Map() };
  private halo: HTMLCanvasElement;
  private haloOn = false;
  private press: Press | null = null;
  /** the notes whose cards were pressed or opened last, the frontmost last (shared/notecard.ts,
   *  raiseCard): their cards over the others' */
  private stack: string[] = [];
  /** the board's ring as this frame reads it, for a note attached to a declaration at the top level,
   *  whose icon scales with the whole board; undefined till it is read */
  private topRing: Ring | null | undefined = undefined;
  /** whether this server has the bytes of a file whose drawing would not load, asked once a file */
  private haves = new Map<string, Promise<boolean>>();
  private editor: HTMLElement | null = null;
  /** the first render shows what was there already: only a note that comes after is new */
  private rendered = false;

  constructor(layer: HTMLElement, canvas: GraphCanvas, hooks: StickyHooks) {
    this.layer = layer;
    this.canvas = canvas;
    this.hooks = hooks;
    this.halo = document.createElement("canvas");
    this.halo.className = "sticky-halo";
    layer.append(this.halo);
    layer.addEventListener("pointerdown", (e) => this.down(e));
    layer.addEventListener("pointermove", (e) => this.move(e));
    layer.addEventListener("pointerup", (e) => this.up(e));
    layer.addEventListener("pointercancel", () => {
      this.press = null;
      this.target = null;
      this.zone = null;
      this.canvas.request();
    });
    // a double-click on a card edits its note; a click on the icon toggles it at once, as nothing
    // else waits on a second click there
    layer.addEventListener("dblclick", (e) => {
      const d = this.noteAt(e.target);
      const t = e.target as HTMLElement;
      if (!d || d.look !== "open" || !t.closest(".sk-card") || t.closest(".tk-decl, [data-att]")) return;
      this.hooks.edit(d.note.id);
    });
    layer.addEventListener("contextmenu", (e) => {
      const d = this.noteAt(e.target);
      if (!d) return;
      e.preventDefault();
      this.hooks.menu(d.note.id, e.clientX, e.clientY);
    });
    // the wheel, and a trackpad's two fingers, scroll a note's text that is longer than its card
    // shows, at its ends too (its overscroll is contained); anywhere else on a note, and with Ctrl
    // (a pinch), they zoom the canvas as anywhere on it (wheelGoes)
    layer.addEventListener(
      "wheel",
      (e) => {
        const t = e.target as HTMLElement;
        if (t.closest(".sticky-editor") || wheelGoes(t.closest<HTMLElement>(".sk-text"), e.ctrlKey) === "text") return;
        e.preventDefault();
        this.canvas.element.dispatchEvent(new WheelEvent("wheel", e));
      },
      { passive: false },
    );
    // what a note carries is drawn once it shows: its card's size, which the ring spaces notes by and
    // the card hangs by, is read again once a drawing has come; one that cannot come says why
    layer.addEventListener(
      "load",
      (e) => {
        const d = (e.target as HTMLElement).tagName === "IMG" ? this.noteAt(e.target) : null;
        if (!d) return;
        d.cardSize = null;
        this.canvas.request();
      },
      true,
    );
    layer.addEventListener("error", (e) => void this.unloaded(e.target as HTMLElement), true);
    // a link in a note goes to its declaration
    layer.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>(".tk-decl");
      if (!a) return;
      e.preventDefault();
      this.hooks.go(a.dataset.decl!);
    });
  }

  /** The board as notes read it (shared/noteplace.ts), read again only when the layout, the board or
   *  its clustering changed. */
  private board(): NoteBoard | null {
    const b = this.hooks.board();
    const L = this.canvas.layout ?? null;
    if (!b || !L) return (this.nb = null);
    const was = this.nbOf;
    if (!this.nb || was.L !== L || was.nodes !== b.nodes || was.mode !== b.mode) {
      this.nb = noteBoard(L, b.mode, b.nodes);
      this.nbOf = { L, nodes: b.nodes, mode: b.mode };
    }
    // a note's attachment names a declaration now: a board of a past build reads it by its name then,
    // and the reader's visitors count as the board's
    this.nb.then = thenNames(b.nowName);
    const vs = this.hooks.visitors();
    this.nb.visiting = vs.length ? new Set(vs) : undefined;
    return this.nb;
  }

  /** The notes, or the board they are on, changed: drawn again, each where its place puts it on the
   *  board on show, or not at all where the board does not show it. A note that was not here before
   *  is lit a moment. */
  render(): void {
    const { project, view } = this.hooks.notes();
    const L = this.canvas.layout;
    this.layoutSeen = L;
    const nb = this.board();
    const b = this.hooks.board();
    const keep = new Set<string>();
    if (nb && b) {
      const exists = existsIn(b.full);
      const index = new Map(L.clusters.map((c, k) => [c.key, k]));
      // which of the project's notes the board shows, and why: read at each render, so that a link
      // made or gone, a note moved or added, shows or hides it at once
      const it = this.hooks.items();
      const links = linksByFile(it.links);
      const projectSpot = (n: ProjectNote): { spot: NoteSpot | null; why: ItemWhy | null } => {
        const why = itemWhy(n, it, nb, exists, links);
        return { why, spot: why ? itemSpot(n, nb, exists, linkedOn(n, nb, links)) : null };
      };
      const all: { kind: NoteKind; note: ProjectNote | StickyNote; spot: NoteSpot | null; why: ItemWhy | null }[] = [
        ...project.map((n) => ({ kind: "project" as const, note: n, ...projectSpot(n) })),
        ...view.map((n) => ({ kind: "view" as const, note: n, spot: viewSpot(n, nb, (key) => index.get(key) ?? -1) as NoteSpot | null, why: null })),
      ];
      for (const { kind, note: n, spot, why } of all) {
        if (!spot || keep.has(n.id)) continue;
        keep.add(n.id);
        let d = this.drawn.get(n.id);
        const fresh = !d;
        // opened since the last render, by anyone, or written just now open: its card in front
        const opened = n.open && (d ? !d.note.open : this.rendered);
        if (!d) {
          const el = document.createElement("div");
          el.className = "sticky";
          el.dataset.id = n.id;
          const part = (cls: string) => {
            const x = document.createElement("div");
            x.className = cls;
            el.append(x);
            return x;
          };
          // its leader, its card and its icon, each placed on the layer by itself: the leaders lie
          // under every icon and dot, and those under every card (shared/notecard.ts, NOTE_Z)
          const lead = part("sk-lead");
          const card = part("sk-card");
          const dlead = part("sk-dlead");
          const dmark = part("sk-dmark");
          const icon = part("sk-ico");
          icon.setAttribute("role", "button");
          this.layer.append(el);
          d = { kind, note: n, el, icon, lead, card, dlead, dmark, spot, why, about: [], look: "hidden", t: 1, drawnAt: "", cardSize: null, world: null, at: null, box: null, angle: null, centre: null, centreAt: 0 };
          this.drawn.set(n.id, d);
          el.hidden = true;
        }
        const about = spot.at === "ring" ? aboutMembers(nb, spot.about) : [];
        Object.assign(d, { kind, note: n, spot, why, about: about.length > ABOUT_MOST ? about.filter((_, k) => k % Math.ceil(about.length / ABOUT_MOST) === 0) : about, centreAt: 0 });
        d.el.classList.toggle("vnote", kind === "view");
        d.el.classList.toggle("ring", spot.at === "ring");
        d.el.classList.toggle("attached", spot.at === "decl");
        // its dot is coloured by what it carries, as its icon is drawn
        const ik = iconKind(n.carries, (sha) => this.hooks.file(sha));
        for (const k of ["note", "image", "paper"] as IconKind[]) d.el.classList.toggle(`nk-${k}`, ik === k);
        // carrying something, a card is as wide as its attachments are drawn
        const cs = n.carries ?? [];
        d.el.classList.toggle("carrying", cs.length > 0);
        d.el.classList.toggle("pictured", cs.some((c) => this.pictured(c)));
        const icon = this.iconHtml(n);
        if (d.icon.dataset.html !== icon) {
          d.icon.innerHTML = icon;
          d.icon.dataset.html = icon;
        }
        d.icon.title = this.iconTitle(n, kind === "view", spot, why);
        d.icon.setAttribute("aria-label", d.icon.title);
        const card = this.cardHtml(n, kind === "view", spot);
        if (d.card.dataset.html !== card) {
          d.card.innerHTML = card;
          d.card.dataset.html = card;
          d.cardSize = null;
        }
        if (fresh && this.rendered) {
          d.el.classList.add("fresh");
          setTimeout(() => d!.el.classList.remove("fresh"), 1400);
        }
        if (opened) this.raise(n.id);
        else if (fresh) this.stackCard(n.id);
      }
    }
    for (const [id, d] of this.drawn)
      if (!keep.has(id)) {
        d.el.remove();
        this.drawn.delete(id);
      }
    this.rendered = true;
    this.frame();
    this.onRender?.();
  }

  /** A note's icon: what it carries — nothing, images, a paper — drawn in a round mark, whose ring is
   *  dashed for a view's own, with how many things it carries where that is more than one. */
  private iconHtml(n: ProjectNote | StickyNote): string {
    const count = carryCount(n.carries);
    // and its dot, which shows as the icon turns into it, zoomed out (shared/notecard.ts, iconShare)
    return ICONS[iconKind(n.carries, (sha) => this.hooks.file(sha))] + (count ? `<span class="sk-count">${count}</span>` : "") + `<span class="sk-dot"></span>`;
  }

  /** What the pointer on an icon says: the note's first line, what it carries, whose it is, what it is
   *  about on the ring, and what a click does. */
  private iconTitle(n: ProjectNote | StickyNote, own: boolean, spot: NoteSpot, why: ItemWhy | null): string {
    const cs = n.carries ?? [];
    const carried = cs.length ? ` — carries ${cs.map((c) => this.carryWords(c)).join("; ")}` : "";
    const whose = own ? " — only in this view" : why === "added" ? " — added to this view" : "";
    const about = spot.at === "ring" && spot.about ? ` — ${aboutWords(spot.about)}` : spot.at === "decl" ? ` — attached to ${spot.name}` : "";
    const first = noteExcerpt(n.text.split("\n").find((l) => l.trim()) ?? n.text, 120);
    return `${first}${carried}${whose}${about}`;
  }

  /** A note's card: its text, what it carries, who wrote it, and, for a view's own (`own`), whose it is. */
  private cardHtml(n: ProjectNote | StickyNote, own: boolean, spot: NoteSpot): string {
    // someone invited by a personal link under the name they go by now, with its ✓ (CollabSpec
    // decision 9)
    const by = n.by ? (n.agent ? `${BOT}${escapeHtml(n.by)}` : nameHtml(n.by, n.person)) : "Someone";
    const ed = n.edited;
    // edited by its author: by the same personal link, or, without one, under the same name
    const other = ed?.by && !(ed.person ? ed.person === n.person : !n.person && ed.by === n.by);
    const edited = ed ? ` · edited${other ? ` by ${nameHtml(ed.by!, ed.person)}` : ""}` : "";
    // a view note says whose it is: the view's mark, and "only in this view" rather than the view's
    // name, as it is only ever drawn on its own view's board (the owner's decision of 2026-10-12)
    const whose = own ? `<div class="sk-whose">${VIEW_MARK}only in this view</div>` : "";
    const words = spot.at === "ring" && spot.about ? aboutWords(spot.about) : "";
    const about = words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "";
    const cs = n.carries ?? [];
    const w = (cs.some((c) => this.pictured(c)) ? CARRY_W.picture : CARRY_W.paper) - INNER_PAD;
    return (
      `<div class="sk-text"${about ? ` title="${escapeHtml(about)}"` : ""}>${renderMarkdown(n.text, (name) => this.hooks.resolve(name))}</div>` +
      (cs.length ? `<div class="sk-carries">${cs.map((c, k) => this.carryHtml(c, k, w)).join("")}</div>` : "") +
      `<div class="sk-by">${by}${edited}</div>${whose}`
    );
  }

  // ---------------------------------------------------------------- what a note carries

  /** Whether a carry is something to look at, drawn at the note's width: an image, or a clip. */
  private pictured(c: NoteCarry): boolean {
    const f = this.hooks.file(c.file);
    return !!f && (f.type !== "pdf" || !!c.region);
  }

  /** A carry in a few words, as a collapsed note's tooltip says it. */
  private carryWords(c: NoteCarry): string {
    const f = this.hooks.file(c.file);
    if (!f) return "a file the library has no record of";
    if (f.type !== "pdf") return `the image ${f.title}`;
    return c.region ? `a clip of ${f.title}, p. ${c.page}` : `${f.title}${c.page ? `, p. ${c.page}` : ""}`;
  }

  /** One file or clip a note carries, `w` pixels wide inside the note: drawn by the server (a clip,
   *  a PDF's page) or as the image is, loaded once the note shows (`loading="lazy"`: a note off the
   *  screen or collapsed is not drawn), never wider nor taller than it is drawn, so never stretched;
   *  an archived file says so, and one the library has no record of says that instead. */
  private carryHtml(c: NoteCarry, k: number, w: number): string {
    const e = escapeHtml;
    const f = this.hooks.file(c.file);
    if (!f) return `<div class="sk-att sk-att-none" data-att="${k}">A file the library has no record of (<code>${c.file.slice(0, 12)}…</code>): it came with a note, not with the review.</div>`;
    const archived = f.archived ? `<span class="sk-att-arch" title="Archived by ${e(f.archived.by)}: restore it from the Library">archived</span>` : "";
    const img = (src: string, cls: string) => `<img class="${cls}" src="${src}" loading="lazy" decoding="async" alt="" draggable="false">`;
    if (f.type !== "pdf")
      return `<button type="button" class="sk-att sk-att-img${f.archived ? " arch" : ""}" data-att="${k}" data-sha="${f.sha}" title="${e(f.title)} — open it in the reference window">${img(`/api/library/file?sha=${f.sha}`, "sk-att-pic")}${archived}</button>`;
    if (c.region) {
      const src = `/api/library/clip?sha=${f.sha}&page=${c.page}&region=${c.region.join(",")}&width=${drawnWidth(w)}`;
      return (
        `<button type="button" class="sk-att sk-att-clip${f.archived ? " arch" : ""}" data-att="${k}" data-sha="${f.sha}" title="A clip of ${e(f.title)}, p. ${c.page} — open the paper there">` +
        `${img(src, "sk-att-pic")}<span class="sk-att-cap">p. ${c.page} · ${e(f.title)}</span>${archived}</button>`
      );
    }
    const page = c.page ?? 1;
    return (
      `<button type="button" class="sk-att sk-att-pdf${f.archived ? " arch" : ""}" data-att="${k}" data-sha="${f.sha}" title="${e(f.title)} — open it${c.page ? ` at p. ${c.page}` : ""} in the reference window">` +
      `${img(`/api/library/page?sha=${f.sha}&page=${page}&width=${drawnWidth(PAGE_W)}`, "sk-att-page")}` +
      `<span class="sk-att-t"><span class="sk-att-title">${e(f.title)}</span><span class="sk-att-meta">PDF${f.pages ? ` · ${f.pages} p.` : ""}${c.page ? ` · at p. ${c.page}` : ""}</span>${archived}</span></button>`
    );
  }

  /** A drawing of what a note carries did not load: this server lacks the file (its record came
   *  with the review from another server), or it cannot be drawn — said in its place. */
  private async unloaded(t: HTMLElement): Promise<void> {
    if (t.tagName !== "IMG") return;
    const att = t.closest<HTMLElement>(".sk-att");
    const sha = att?.dataset.sha;
    if (!att || !sha) return;
    let have = this.haves.get(sha);
    if (!have) {
      have = fetch(`/api/library/info?sha=${sha}`)
        .then((r) => r.json())
        .then((b: { file?: { have?: boolean } }) => b.file?.have !== false)
        .catch(() => true);
      this.haves.set(sha, have);
    }
    const title = this.hooks.file(sha)?.title ?? "this file";
    const why = (await have) ? `${title} cannot be drawn here.` : `This server does not have the file of ${title}: add it from the Library.`;
    const say = document.createElement("span");
    say.className = "sk-att-why";
    say.textContent = why;
    t.replaceWith(say);
    att.classList.add("failed");
    const d = this.noteAt(att);
    if (d) d.cardSize = null;
    this.canvas.request();
  }

  /** Where each note is now, and how it shows: called every frame the canvas draws. */
  frame(): void {
    const C = this.canvas;
    if (C.layout !== this.layoutSeen) return this.render();
    if (!this.drawn.size && !this.markers.size) return this.drawHalo();
    const S = C.scene;
    const W = innerWidth, H = innerHeight;
    this.topRing = undefined;
    const onRing: Drawn[] = [];
    const inCluster: number[] = [];
    for (const d of this.drawn.values()) {
      if (d.spot.at === "ring") {
        onRing.push(d);
        continue;
      }
      const c = this.clusterOf(d);
      if (c >= 0) inCluster.push(c);
      const s = this.spotWorld(d);
      // its icon, its dot or a blend of the two, as what it belongs to shows at this zoom
      const { look, t } = markLook(d.note.open, s?.level ?? null, C.cam.k, !s);
      if (look === "hidden" || !s) this.show(d, "hidden");
      else this.place(d, s.x, s.y, look, t, s.point);
    }
    this.frameRing(onRing);
    // what would hold the note whose icon is dragged, were it let go now, and the circle round the
    // declaration it is attached to
    const p = this.dragging();
    const d = p?.part === "icon" && p.now ? this.drawn.get(p.id) : undefined;
    const aim = d && p?.now ? this.aimFor(d, p.now) : null;
    this.target = aim?.target ?? null;
    this.zone = aim?.zone ?? null;
    // the folded clusters that hide notes, each with how many
    const marks = noteMarkers(inCluster, (c) => this.foldedAround(c));
    for (const [c, el] of this.markers)
      if (!marks.has(c)) {
        el.remove();
        this.markers.delete(c);
      }
    const k = C.cam.k;
    for (const [c, n] of marks) {
      let el = this.markers.get(c);
      if (!el) {
        el = document.createElement("button");
        el.className = "sticky-mark";
        el.dataset.c = String(c);
        el.addEventListener("click", () => this.hooks.unfold(Number(el!.dataset.c)));
        this.layer.append(el);
        this.markers.set(c, el);
      }
      const label = `${NOTE_ICON}<span>${n}</span>`;
      if (el.dataset.n !== String(n)) {
        el.innerHTML = label;
        el.dataset.n = String(n);
        el.title = `${n} note${n === 1 ? "" : "s"} inside ${C.layout.clusters[c].key.split(".").pop()} — click to unfold it, for everyone on this board`;
      }
      const r = Math.max(S.drawnR[c], 6 / k);
      const [sx, sy] = C.toScreen(S.cwx[c] + r * 0.62, S.cwy[c] - r * 0.62);
      el.hidden = !C.isClusterShown(c) || sx < -40 || sy < -40 || sx > W + 40 || sy > H + 40;
      el.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy - 10)}px)`;
    }
    this.drawHalo();
  }

  /** The outermost folded cluster around cluster `c` (itself included), or -1. */
  private foldedAround(c: number): number {
    const S = this.canvas.scene;
    let out = -1;
    for (let x = c; x >= 0; x = S.parent[x]) if (S.folded.has(x)) out = x;
    return out;
  }

  /** The cluster of the layout a note in a cluster, or attached to a declaration, is in — which a fold
   *  hides it in, and whose name its card keeps off —, or the folded cluster whose card hides the
   *  visitor it is attached to; -1 for none (the canvas, the ring, the top level). */
  private clusterOf(d: Drawn): number {
    const s = d.spot;
    if (s.at === "cluster" || s.at === "offset") return s.c;
    if (s.at !== "decl") return -1;
    if (s.j >= 0) return this.canvas.layout.cluster[s.j] ?? -1;
    return this.canvas.visitorCard(this.hooks.visitors().indexOf(s.name));
  }

  /** Where a note in a cluster, on the canvas or attached to a declaration is now, in the board's
   *  world — its place, or its spot at its offset from its declaration's point (`point`) — and what it
   *  belongs to, which its icon scales with (shared/notecard.ts, levelOf: its cluster's circle, by the
   *  radius drawn, or for an attached note the circle that holds its declaration; nothing on the
   *  canvas); null where it does not show — in a folded cluster, or one the board does not draw. */
  private spotWorld(d: Drawn): { x: number; y: number; level: NoteLevel; point?: [number, number] } | null {
    const C = this.canvas;
    const S = C.scene;
    if (d.spot.at === "world") return { x: d.spot.x, y: d.spot.y, level: null };
    if (d.spot.at === "ring") return null;
    if (d.spot.at === "decl") {
      // the declaration's point, unless a fold hides it; a visitor's where the reader's visitors are,
      // in the board's cluster it is placed in
      const j = d.spot.j;
      let c = -1;
      let point: [number, number] | null = null;
      if (j >= 0) {
        c = C.layout.cluster[j] ?? -1;
        if (C.nodeRep[j] >= 0 || (c >= 0 && !C.isClusterShown(c))) return null;
        point = C.posOf(j);
      } else {
        const k = this.hooks.visitors().indexOf(d.spot.name);
        point = k >= 0 && C.visitorCard(k) < 0 ? C.visitorPos(k) : null;
        c = C.visitorIn(k);
      }
      if (!point) return null;
      const [x, y] = declSpot(point, d.spot.d);
      return { x, y, point, level: levelOf("decl", c, (c) => S.drawnR[c], c < 0 ? this.boardRing()?.r ?? null : null) };
    }
    const c = d.spot.c;
    if (this.foldedAround(c) >= 0 || !C.isClusterShown(c)) return null;
    const R = S.drawnR[c];
    if (d.spot.at === "cluster")
      // a fraction of the radius drawn: the same spot of the circle whatever its size
      return { x: S.cwx[c] + d.spot.f[0] * R, y: S.cwy[c] + d.spot.f[1] * R, level: { r: R } };
    // kept inside its circle, however the circle changed since it was put there
    const [dx, dy] = d.spot.d;
    const len = Math.hypot(dx, dy);
    const f = len > R ? R / len : 1;
    const s = S.scale[c];
    return { x: S.cwx[c] + dx * f * s, y: S.cwy[c] + dy * f * s, level: { r: R } };
  }

  /** The board's ring as this frame reads it (ringNow), read once a frame. */
  private boardRing(): Ring | null {
    if (this.topRing === undefined) this.topRing = this.ringNow();
    return this.topRing;
  }

  /** The press that drags something of a note now, or null. */
  private dragging(): Press | null {
    const p = this.press;
    return p && p.moved && p.moves ? p : null;
  }

  /** Note `d` drawn at (wx, wy) of the board's world — its place, or, attached to a declaration whose
   *  point is at `point`, its spot at its offset from it —, in `look`, `t` of its icon showing (1 its
   *  icon, 0 its dot, between a blend: shared/notecard.ts, iconShare): its mark, and where it is open
   *  its card, hanging as its offset says and flipped to stay on the screen, joined to the icon by its
   *  leader; attached, the dashed leader to the declaration's point. Hidden where its mark is off the
   *  screen. What is dragged follows the pointer instead: the icon with its card, or the card alone. */
  private place(d: Drawn, wx: number, wy: number, look: "open" | "shut", t = 1, point: [number, number] | null = null): void {
    const C = this.canvas;
    const k = C.cam.k;
    const p = this.dragging()?.id === d.note.id ? this.press : null;
    let [sx, sy] = C.toScreen(wx, wy);
    const held = p?.part === "icon" && !!p.now;
    if (held) {
      [sx, sy] = p!.now!;
      t = 1;
    }
    if (!p && (sx < -OFF_PX || sy < -OFF_PX || sx > innerWidth + OFF_PX || sy > innerHeight + OFF_PX)) return this.show(d, "hidden");
    this.show(d, look);
    d.t = t;
    d.world = held ? C.toWorld(sx, sy) : [wx, wy];
    d.at = [sx, sy];
    const r = markR(t, k);
    const scale = r / ICON_R;
    const drawn = `${Math.round(sx)},${Math.round(sy)},${scale.toFixed(3)},${t.toFixed(3)}`;
    if (d.drawnAt !== drawn) {
      d.drawnAt = drawn;
      d.icon.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px)${t < 1 ? ` scale(${scale.toFixed(3)})` : ""}`;
      // how much of the icon shows, and its dot's outline and the pointer's reach on the screen
      // whatever its scale
      d.icon.style.setProperty("--t", t.toFixed(3));
      d.icon.style.setProperty("--s", scale.toFixed(3));
      d.icon.style.setProperty("--hit", `${Math.max(0, (DOT_HIT_PX - r) / scale).toFixed(1)}px`);
      d.el.classList.toggle("shrunk", t < 1);
    }
    // attached: the leader to the point while its icon shows, none while it is a dot
    this.placeDeclLead(d, point && !held && t > 0 ? C.toScreen(point[0], point[1]) : null, [sx, sy], r, t);
    if (look !== "open") {
      d.box = null;
      return;
    }
    const [w, h] = this.cardSizeOf(d);
    let box: Box;
    if (p?.part === "card" && p.now) box = { x0: p.now[0], y0: p.now[1], x1: p.now[0] + w, y1: p.now[1] + h };
    else {
      const { off, avoid } = this.hangOf(d, w, h);
      box = hangCard([sx, sy], off, w, h, this.room(), avoid).box;
    }
    d.box = box;
    d.card.style.transform = `translate(${Math.round(box.x0)}px, ${Math.round(box.y0)}px)`;
    const line = leaderLine(sx, sy, box);
    d.lead.hidden = !line;
    if (line) {
      const [x0, y0, x1, y1] = line;
      d.lead.style.width = `${Math.hypot(x1 - x0, y1 - y0).toFixed(1)}px`;
      d.lead.style.transform = `translate(${x0.toFixed(1)}px, ${y0.toFixed(1)}px) rotate(${Math.atan2(y1 - y0, x1 - x0).toFixed(4)}rad)`;
    }
  }

  /** The dashed leader of a note attached to a declaration, from its icon (at `icon`, `r` round, `t` of
   *  it showing) to the declaration's point (at `point`, null: none drawn — not attached, its icon
   *  dragged, or its dot alone), and the diamond on the point's rim, fading and shrinking with the
   *  icon: the line's width and the diamond scale as the icon does. */
  private placeDeclLead(d: Drawn, point: [number, number] | null, icon: [number, number], r: number, t: number): void {
    // a visitor is drawn larger than a point, as a lit point is (web/src/canvas.ts, visitorR)
    const pr = pointPx(this.canvas.cam.k);
    const s = r / ICON_R;
    const g = point ? declLeader(point, icon, r, d.spot.at === "decl" && d.spot.j < 0 ? Math.max(5, pr * 1.5) : pr, s) : null;
    d.dlead.hidden = d.dmark.hidden = !g;
    if (!g) return;
    const [x0, y0, x1, y1] = g.line;
    d.dlead.style.width = `${Math.hypot(x1 - x0, y1 - y0).toFixed(1)}px`;
    d.dlead.style.transform = `translate(${x0.toFixed(1)}px, ${y0.toFixed(1)}px) rotate(${Math.atan2(y1 - y0, x1 - x0).toFixed(4)}rad)`;
    d.dlead.style.borderTopWidth = `${(DLEAD_PX * s).toFixed(2)}px`;
    d.dmark.style.transform = `translate(${g.mark[0].toFixed(1)}px, ${g.mark[1].toFixed(1)}px) rotate(45deg) scale(${s.toFixed(3)})`;
    d.dlead.style.opacity = d.dmark.style.opacity = t.toFixed(3);
  }

  /** How note `d`'s card hangs from its icon before any flip, as a card `w` × `h`: at its own offset,
   *  clear of the icon; else outward on the ring, or up and to the right, keeping off its cluster's
   *  name where it can (`avoid`). */
  private hangOf(d: Drawn, w: number, h: number): { off: NoteCard; avoid: Box | null } {
    if (d.note.card) return { off: clearOfIcon(d.note.card, w, h), avoid: null };
    // outward on the ring, its nearest corner kept off the icon where the ray runs aslant
    if (d.spot.at === "ring") return { off: clearOfIcon(ringCard(d.angle ?? -Math.PI / 2, w, h), w, h), avoid: null };
    const c = this.clusterOf(d);
    const lb = c >= 0 ? this.canvas.labelOf(c) : null;
    return { off: defaultCard(w, h), avoid: lb ? { x0: lb[0], y0: lb[1], x1: lb[2], y1: lb[3] } : null };
  }

  /** The room a card stays in: the screen the bars and panels leave, a little inside it. */
  private room(): Box {
    const I = this.canvas.insets;
    return { x0: I.left + ROOM_PAD, y0: I.top + ROOM_PAD, x1: innerWidth - I.right - ROOM_PAD, y1: innerHeight - I.bottom - ROOM_PAD };
  }

  /** What would hold note `d` let go with its icon at `icon` (pixels of the screen) — another
   *  declaration it would be attached to, the cluster it would be put in, the ring, or nothing: inside
   *  the circle round the declaration it is attached to, where it stays, or a view note on the canvas —
   *  the same rules as letting it go (dropFor); and, for a note attached to a declaration, that circle,
   *  drawn while it is dragged. */
  private aimFor(d: Drawn, icon: [number, number]): { target: DropTarget; zone: Zone | null } {
    const { to: at, own } = this.declFor(d, icon);
    const zone = own && d.spot.at === "decl" ? { point: own, label: d.spot.j >= 0 ? this.canvas.g.short(d.spot.j) : shortName({ name: d.spot.name }), inside: !!at?.stay } : null;
    if (at) return { target: !at.stay && at.j >= 0 ? { at: "decl", j: at.j } : null, zone };
    const nb = this.board();
    const to = this.placeFor(d.kind, this.canvas.toWorld(icon[0], icon[1]));
    if (!nb || !to) return { target: null, zone };
    const L = this.canvas.layout;
    if (this.indexOf.L !== L) this.indexOf = { L, map: new Map(L.clusters.map((c, j) => [c.key, j])) };
    const index = this.indexOf.map;
    return { target: dropTarget(to.kind === "project" ? { kind: "project", place: to.place } : { kind: "view", place: to.place }, (key) => nb.stands.get(key), (key) => index.get(key) ?? -1), zone };
  }

  /** The declaration note `d` is attached to once its icon is let go at `icon` (pixels of the screen),
   *  and the offset it keeps from it in the board's units (shared/notecard.ts, declDrop): another one
   *  under the icon, where declarations can be pointed at, else its own where the icon is inside the
   *  circle round its point (`stay`); null for none. A visitor it is attached to is -1, as its spot
   *  says. `own` is the point of the one it is attached to, in the world: the circle's centre. */
  private declFor(d: Drawn, icon: [number, number]): { to: { j: number; d: [number, number]; stay: boolean } | null; own: [number, number] | null } {
    const C = this.canvas;
    const k = C.cam.k;
    const hit = declsPointable(k) ? C.nodeAt(icon[0], icon[1]) : null;
    const under = hit !== null ? { j: hit, at: C.posOf(hit) } : null;
    let own: { j: number; at: [number, number] } | null = null;
    if (d.spot.at === "decl") {
      const w = this.spotWorld(d);
      if (w?.point) own = { j: d.spot.j, at: w.point };
    }
    return { to: declDrop(C.toWorld(icon[0], icon[1]), under, own, k), own: own?.at ?? null };
  }

  /** Where note `d` goes when its icon is let go at `icon` (pixels of the screen; the owner's decisions
   *  of 2026-10-12): attached to another declaration under it, or kept attached to its own inside the
   *  circle round it, at the offset it was let go at — its place under the board's clustering then
   *  beside the declaration, where it falls back to, and, attached afresh, a note of the project's
   *  under the other clustering too, beside it in the Project's layout of it —; else detached, where a
   *  free note let go there goes (placeFor). The attachment names the declaration now, on a board of a
   *  past build too. Null where the board is not drawn yet. */
  private dropFor(d: Drawn, icon: [number, number]): Dropped | null {
    const C = this.canvas;
    const b = this.hooks.board();
    const nb = this.board();
    if (!b || !nb) return null;
    const world = C.toWorld(icon[0], icon[1]);
    const at = this.declFor(d, icon).to;
    if (!at) {
      const to = this.placeFor(d.kind, world);
      return to && { decl: null, to };
    }
    const then = at.j >= 0 ? C.g.nodes[at.j].name : (d.spot as Extract<NoteSpot, { at: "decl" }>).name;
    const name = b.nowName?.get(then) ?? then;
    const decl: NoteDecl = { name, at: at.d };
    // a visitor is not on the board's layout: its place stays as it is
    if (at.j < 0) return { decl, to: null };
    const afresh = d.spot.at !== "decl" || d.spot.j !== at.j;
    // where it falls back to is where it now sits, at the offset kept
    const [x, y] = C.posOf(at.j);
    const spot = declSpot([x, y], at.d);
    if (d.kind === "view") {
      const c = C.layout.cluster[at.j] ?? -1;
      return { decl, to: { kind: "view", place: c >= 0 ? viewPlaceIn(b.mode, spot, this.clusters(), c) : placeAt(b.mode, spot, []) } };
    }
    const here = besidePlace(at.j, spot, this.clusters(), nb);
    const ring = this.ring ?? this.ringNow();
    const place = here ?? (ring ? { ring: angleOf(ring, x, y) } : null);
    const out: Dropped = { decl, to: place ? { kind: "project", mode: b.mode, place } : null };
    if (afresh) {
      const other = otherMode(b.mode);
      const w = this.hooks.whole(other);
      const i = w?.index.get(name);
      const there = w && i !== undefined ? declPlace(w.L, i, BESIDE_UNITS) : null;
      if (there) out.also = { mode: other, place: there };
    }
    return out;
  }

  /** The board's ring as drawn now: just outside its top-level circles and declarations. */
  private ringNow(): Ring | null {
    const C = this.canvas;
    const S = C.scene;
    const discs: { x: number; y: number; r: number }[] = [];
    for (const c of S.rootC) if (C.isClusterShown(c)) discs.push({ x: S.cwx[c], y: S.cwy[c], r: S.drawnR[c] });
    for (const i of S.rootN) {
      const [x, y] = C.posOf(i);
      discs.push({ x, y, r: 8 });
    }
    return ringAround(discs);
  }

  /** The notes on the rings: each icon on a ring at its angle — where it was let go, or that of what
   *  it is about — at least a fixed gap from its neighbours on the screen, those a ring cannot hold so
   *  on rings further out (shared/ring.ts, packRings), its card hanging outward. The note whose icon
   *  is dragged has left them: the others make room. */
  private frameRing(ds: Drawn[]): void {
    const C = this.canvas;
    const ring = (this.ring = ds.length ? this.ringNow() : null);
    if (!ring) {
      for (const d of ds) this.show(d, "hidden");
      return;
    }
    const k = C.cam.k;
    const rpx = ring.r * k;
    const p = this.dragging();
    const out = p?.part === "icon" ? ds.find((d) => d.note.id === p.id) : undefined;
    const live = out ? ds.filter((d) => d !== out) : ds;
    const look = (d: Drawn) => noteLook(d.note.open, rpx);
    // shown first, so that a card that comes into sight can be measured for the spacing
    for (const d of live) this.show(d, look(d));
    const now = performance.now();
    const spots = packRings(live.map((d) => this.ringItem(d, ring, now)), rpx);
    live.forEach((d, j) => {
      const a = (d.angle = spots[j].a);
      const r = ring.r + (spots[j].ring * RING_STEP_PX) / k;
      this.place(d, ring.x + r * Math.cos(a), ring.y + r * Math.sin(a), look(d));
    });
    if (out) this.place(out, ...(out.world ?? [ring.x, ring.y - ring.r]), look(out));
  }

  /** The angle a note on the ring wants, in radians: where it was let go, else that of the centre of
   *  what it is about — read again a few times a second (`now`), not every frame — else none. */
  private wantOf(d: Drawn, ring: Ring, now: number): number | null {
    const s = d.spot as Extract<NoteSpot, { at: "ring" }>;
    if (s.angle !== null) return ringRadians(s.angle);
    if (!d.about.length) return null;
    if (!d.centre || now - d.centreAt > CENTRE_MS) {
      let x = 0, y = 0;
      for (const j of d.about) {
        const p = this.canvas.posOf(j);
        x += p[0];
        y += p[1];
      }
      d.centre = [x / d.about.length, y / d.about.length];
      d.centreAt = now;
    }
    return aboutAngle(ring, d.centre);
  }

  /** A note's card's size, as last measured where it shows, else about what a card of its kind takes:
   *  its text, and what it carries. */
  private cardSizeOf(d: Drawn): [number, number] {
    if (!d.cardSize && d.look === "open" && !d.el.hidden && d.card.offsetWidth) {
      d.cardSize = [d.card.offsetWidth, d.card.offsetHeight];
      // a text longer than the card shows scrolls under a finger too (web/style.css, .scrolls)
      const text = d.card.querySelector<HTMLElement>(".sk-text");
      text?.classList.toggle("scrolls", scrolls(text));
    }
    if (d.cardSize) return d.cardSize;
    const cs = d.note.carries ?? [];
    return cs.length ? [cs.some((c) => this.pictured(c)) ? CARRY_W.picture : CARRY_W.paper, 70 + 200 * cs.length] : [240, 90];
  }

  /** A note on the rings as packing reads it: the angle it wants, when it was written, its icon, and,
   *  where it is expanded, its card's size, which hangs outward from the icon and counts where the
   *  rings are large enough on the screen to show cards. */
  private ringItem(d: Drawn, ring: Ring, now: number): RingItem {
    const it: RingItem = { want: this.wantOf(d, ring, now), order: d.note.at, icon: ICON_PX };
    if (d.note.open) it.open = this.cardSizeOf(d);
    return it;
  }

  /** How note `d`'s card hangs, unflipped, for framing the board: its offset and size (`angle`, its
   *  angle on the ring where it is there). */
  private cardFit(d: Drawn, angle: number | null): { off: NoteCard; w: number; h: number } {
    const [w, h] = this.cardSizeOf(d);
    const off = d.note.card ? clearOfIcon(d.note.card, w, h) : angle !== null ? clearOfIcon(ringCard(angle, w, h), w, h) : defaultCard(w, h);
    return { off, w, h };
  }

  /** What Fit to screen frames besides the board, at zoom `k` (CanvasSpec, "Notes"): every note's icon
   *  — on the rings each where packing puts it at that zoom — and with `cards` the card of each
   *  that shows expanded at that zoom, as it hangs there unflipped. A note in a folded cluster is
   *  hidden, and not framed. */
  fitBoxes(k: number, cards: boolean): FitBox[] {
    const notes: FitNote[] = [];
    const ringed: Drawn[] = [];
    for (const d of this.drawn.values()) {
      if (d.spot.at === "ring") {
        ringed.push(d);
        continue;
      }
      const s = this.spotWorld(d);
      if (!s) continue;
      // its icon where it shows at the zoom tried, else its dot, at its spot on the board; its card
      // only where its icon shows
      notes.push({
        x: s.x,
        y: s.y,
        mark: (z) => ({ d: [0, 0], r: markR(iconShare(s.level, z), z) }),
        card: (z) => (markLook(d.note.open, s.level, z).look === "open" ? this.cardFit(d, null) : null),
      });
    }
    const ring = ringed.length ? this.ringNow() : null;
    if (ring) {
      // each where packing puts it at that zoom: the outermost ring in use is framed with the board
      const rpx = ring.r * k;
      const now = performance.now();
      packRings(ringed.map((d) => this.ringItem(d, ring, now)), rpx).forEach(({ ring: j, a }, i) => {
        const d = ringed[i];
        const r = ring.r + (j * RING_STEP_PX) / k;
        notes.push({ x: ring.x + r * Math.cos(a), y: ring.y + r * Math.sin(a), card: () => (noteLook(d.note.open, rpx) === "open" ? this.cardFit(d, a) : null) });
      });
    }
    return noteBoxes(notes, k, cards);
  }

  /** Drawn over the canvas, under the notes: what would hold the note whose icon is dragged, were it
   *  let go now — its cluster's circle outlined, with its name, a declaration, or the ring — in the
   *  accent colour; and while the icon of a note attached to a declaration is dragged, the circle round
   *  that declaration in which it stays attached, under what would hold it elsewhere. */
  private drawHalo(): void {
    const t = this.target;
    const z = this.zone;
    const cv = this.halo;
    if (!t && !z) {
      if (this.haloOn) {
        cv.getContext("2d")!.clearRect(0, 0, cv.width, cv.height);
        this.haloOn = false;
      }
      return;
    }
    const dpr = devicePixelRatio || 1;
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    const g = cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, innerWidth, innerHeight);
    const css = getComputedStyle(this.layer);
    const accent = css.getPropertyValue("--note-icon").trim() || "#4a7cf7";
    g.strokeStyle = accent;
    g.fillStyle = accent;
    if (z) this.drawZone(g, z, accent, css);
    if (t) this.drawTarget(g, t, accent, css);
    this.haloOn = true;
  }

  /** The circle round the declaration a dragged note is attached to (shared/notecard.ts, zonePx),
   *  dashed in the accent: faint while the icon is out of it, where the note is dragged as a free note
   *  is; with the icon inside, where the note would stay, stronger and a little filled, with the
   *  declaration's name on a chip, as what would hold it. A rim of the page's surface under the dashes
   *  keeps them apart from the edges and points they cross, in either theme. */
  private drawZone(g: CanvasRenderingContext2D, z: Zone, accent: string, css: CSSStyleDeclaration): void {
    const C = this.canvas;
    const [cx, cy] = C.toScreen(z.point[0], z.point[1]);
    const r = zonePx(C.cam.k);
    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, 2 * Math.PI);
    if (z.inside) {
      g.globalAlpha = 0.08;
      g.fill();
    }
    g.globalAlpha = z.inside ? 0.7 : 0.45;
    g.strokeStyle = css.getPropertyValue("--surface-solid").trim() || "#fff";
    g.lineWidth = z.inside ? 4.5 : 3.5;
    g.stroke();
    g.globalAlpha = z.inside ? 1 : 0.85;
    g.strokeStyle = accent;
    g.lineWidth = z.inside ? 2 : 1.5;
    g.setLineDash([6, 5]);
    g.stroke();
    g.restore();
    if (z.inside) this.chip(g, z.label, cx, cy - r - 14, accent, css);
  }

  /** What would hold a dragged note, drawn: the circle outlined in the accent, a little filled, and
   *  its name on a chip where the canvas wrote it (above the circle where it did not); the ring
   *  dashed, with what it is. */
  private drawTarget(g: CanvasRenderingContext2D, t: NonNullable<DropTarget>, accent: string, css: CSSStyleDeclaration): void {
    const C = this.canvas;
    const S = C.scene;
    let cx: number, cy: number, r: number, label: string;
    let at: [number, number] | null = null;
    if (t.at === "decl") {
      // the declaration it would be attached to, lit as a cluster is: a ring round its point
      [cx, cy] = C.toScreen(...C.posOf(t.j));
      // round the icon that covers the point while it is dragged there, so that it shows
      r = Math.max(pointPx(C.cam.k) + 6, ICON_R + 5);
      label = C.g.short(t.j);
    } else if (t.at === "cluster") {
      [cx, cy] = C.toScreen(S.cwx[t.c], S.cwy[t.c]);
      r = Math.max(S.drawnR[t.c] * C.cam.k, 6);
      label = C.layout.clusters[t.c].label.replace("⟨external⟩", "External");
      const lb = C.labelOf(t.c);
      if (lb) at = [(lb[0] + lb[2]) / 2, (lb[1] + lb[3]) / 2];
    } else {
      const ring = this.ring ?? this.ringNow();
      if (!ring) return;
      [cx, cy] = C.toScreen(ring.x, ring.y);
      r = ring.r * C.cam.k;
      label = "The ring, around the whole board";
    }
    g.save();
    g.lineWidth = 2;
    if (t.at === "ring") g.setLineDash([7, 5]);
    g.beginPath();
    g.arc(cx, cy, r, 0, 2 * Math.PI);
    g.globalAlpha = t.at === "ring" ? 0.04 : t.at === "decl" ? 0.16 : 0.08;
    g.fill();
    g.globalAlpha = 1;
    g.stroke();
    g.restore();
    const [lx, ly] = at ?? [cx, cy - r - 14];
    this.chip(g, label, lx, ly, accent, css);
  }

  /** A name on a chip of the page's surface, outlined in the accent, centred at (lx, ly) and kept
   *  inside the screen the bars and panels leave. */
  private chip(g: CanvasRenderingContext2D, label: string, lx: number, ly: number, accent: string, css: CSSStyleDeclaration): void {
    g.save();
    g.font = `600 12px ${css.getPropertyValue("--font").trim() || "sans-serif"}`;
    const tw = g.measureText(label).width;
    const I = this.canvas.insets;
    const x = Math.max(I.left + tw / 2 + 12, Math.min(innerWidth - I.right - tw / 2 - 12, lx));
    const y = Math.max(I.top + 14, Math.min(innerHeight - I.bottom - 14, ly));
    g.beginPath();
    g.roundRect(x - tw / 2 - 8, y - 10, tw + 16, 20, 10);
    g.fillStyle = css.getPropertyValue("--surface-solid").trim() || "#fff";
    g.fill();
    g.strokeStyle = accent;
    g.lineWidth = 1.2;
    g.stroke();
    g.fillStyle = accent;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, x, y + 0.5);
    g.restore();
  }

  private show(d: Drawn, look: Drawn["look"]): void {
    // collapsed by the zoom while its own state is open: a click on the icon brings it near enough
    d.el.classList.toggle("auto", look === "shut" && d.note.open);
    if (d.look === look) return;
    d.look = look;
    if (look === "hidden") {
      d.world = null;
      d.at = null;
      d.box = null;
      d.drawnAt = "";
    }
    d.el.hidden = look === "hidden";
    d.el.classList.toggle("open", look === "open");
  }

  private noteAt(t: EventTarget | null): Drawn | null {
    const el = (t as HTMLElement | null)?.closest?.<HTMLElement>(".sticky");
    return el ? this.drawn.get(el.dataset.id!) ?? null : null;
  }

  // ---------------------------------------------------------------- places

  /** The board on show's clusters as a note's place reads them: where each is drawn now, and whether
   *  a note can go in it (open: not folded, not inside a folded one, shown — and, `seen`, large
   *  enough on the screen to point at, as the pointer's highlight and the canvas's menu take a
   *  cluster: a note of the project shows where its cluster is, so it goes in the one the reader
   *  sees it go in, not in a speck of a cluster under the pointer). */
  private clusters(seen = false): PlaceCluster[] {
    const C = this.canvas;
    const S = C.scene;
    const k = C.cam.k;
    return C.layout.clusters.map((c, j) => ({ key: c.key, parent: c.parent, depth: c.depth, x: S.cwx[j], y: S.cwy[j], r: S.drawnR[j], open: !S.collapsed(j) && C.isClusterShown(j) && (!seen || S.drawnR[j] * k >= SEEN_PX) }));
  }

  /** Where a note of `kind` goes when its icon is put at a spot of the board: a project note in the
   *  most specific open cluster there, else on the ring at that angle; a view note as it always went.
   *  Null where the board is not drawn yet. */
  placeFor(kind: NoteKind, world: [number, number]): PlaceFor | null {
    const b = this.hooks.board();
    const nb = this.board();
    if (!b || !nb) return null;
    if (kind === "view") return { kind, place: placeAt(b.mode, world, this.clusters()) };
    const clusters = this.clusters(true);
    const inside = placeIn(world, clusters, nb);
    if (inside) return { kind, mode: b.mode, place: inside };
    const ring = this.ring ?? this.ringNow();
    return ring ? { kind, mode: b.mode, place: { ring: angleOf(ring, world[0], world[1]) } } : null;
  }

  /** Where `n` notes of the project go that are put at one spot together (files dropped at once):
   *  the first as a note put there goes, the others beside it, a note's width apart on the screen,
   *  in the same cluster and brought inside its circle; on the ring, all at that angle, which spreads
   *  them as it spreads every note on it. Null where the board is not drawn yet. */
  placesFor(world: [number, number], n: number): Extract<PlaceFor, { kind: "project" }>[] | null {
    const first = this.placeFor("project", world);
    const nb = this.board();
    if (!first || first.kind !== "project" || !nb) return null;
    return spacedPlaces(first.place, world, n, (CARRY_W.picture + 16) / this.canvas.cam.k, this.clusters(), nb).map((place) => ({ ...first, place }));
  }

  /** Where a note of the project goes beside declaration `j` of the board (the canvas's numbering):
   *  in its cluster under the board's clustering — the innermost of its keys that is a circle drawn,
   *  a hidden level's note being in the one drawn around it — just beside its point, whatever is
   *  folded or how small it is on the screen; on the ring at its angle where it is at the top level.
   *  Null where the board is not drawn yet. */
  placeBeside(j: number): Extract<PlaceFor, { kind: "project" }> | null {
    const b = this.hooks.board();
    const nb = this.board();
    if (!b || !nb) return null;
    const [x, y] = this.canvas.posOf(j);
    const k = this.canvas.cam.k;
    const place = besidePlace(j, [x + BESIDE_PX / k, y - BESIDE_PX / k], this.clusters(), nb);
    if (place) return { kind: "project", mode: b.mode, place };
    const ring = this.ring ?? this.ringNow();
    return ring ? { kind: "project", mode: b.mode, place: { ring: angleOf(ring, x, y) } } : null;
  }

  /** Where a note of the project goes in cluster `c` of the board, put there without a spot: up and
   *  to the right of its middle, where its own label does not run. Null where it is not drawn. */
  placeInCluster(c: number): Extract<PlaceFor, { kind: "project" }> | null {
    const b = this.hooks.board();
    const nb = this.board();
    if (!b || !nb) return null;
    const clusters = this.clusters();
    const C = clusters[c];
    const place = C ? spotIn(C.key, [C.x + C.r * 0.3, C.y - C.r * 0.3], clusters, nb) : null;
    return place ? { kind: "project", mode: b.mode, place } : null;
  }

  /** Put note `id` at a spot of the board inside cluster `key` (null: in none), as letting it go
   *  there would: the linear form's drop (web/src/linear.ts, ExportSpec decision 18). It keeps
   *  whatever it is attached to. False where the board is not drawn or the note not on it. */
  moveInto(id: string, key: string | null, world: [number, number]): boolean {
    const d = this.drawn.get(id);
    const b = this.hooks.board();
    const nb = this.board();
    if (!d || !b || !nb) return false;
    const clusters = this.clusters();
    let to: PlaceFor | null = null;
    if (key === null) to = this.placeFor(d.kind, world);
    else if (d.kind === "project") {
      const place = spotIn(key, world, clusters, nb);
      if (place) to = { kind: "project", mode: b.mode, place };
    } else {
      const c = clusters.findIndex((x) => x.key === key);
      if (c >= 0) to = { kind: "view", place: viewPlaceIn(b.mode, world, clusters, c) };
    }
    if (!to) return false;
    this.hooks.moved(id, { decl: d.note.decl ?? null, to });
    return true;
  }

  /** The notes the board shows now, each where its icon is in the board's world, with its first
   *  words: what an artwork draws (web/src/artwork.ts). */
  shownNotes(): { world: [number, number]; words: string }[] {
    const out: { world: [number, number]; words: string }[] = [];
    for (const d of this.drawn.values()) if (d.world && d.look !== "hidden") out.push({ world: d.world, words: firstWords(d.note.text) });
    return out;
  }

  /** Where note `id`'s icon is drawn now, in the board's world: its place; null where it does not
   *  show. */
  spotOf(id: string): [number, number] | null {
    return this.drawn.get(id)?.world ?? null;
  }

  // ---------------------------------------------------------------- the pointer

  private down(e: PointerEvent): void {
    const d = this.noteAt(e.target);
    const t = e.target as HTMLElement;
    // the right button opens the note's menu (contextmenu) and moves nothing
    if (!d || e.button !== 0 || t.closest(".tk-decl") || !d.at) return;
    const part = t.closest(".sk-ico") ? "icon" : t.closest(".sk-card") && d.box ? "card" : null;
    if (!part) return;
    // a finger on a note's text that scrolls, or the mouse on its scrollbar, scrolls it: it neither
    // pans nor moves the card (textPress)
    const text = part === "card" ? t.closest<HTMLElement>(".sk-text") : null;
    if (text && textPress(text, e.pointerType, text.getBoundingClientRect().right - e.clientX)) return;
    e.preventDefault();
    // a dot, or an icon still turning into one, is no icon to move: a drag on it pans
    const dot = part === "icon" && d.t < 1;
    const att = part === "card" ? t.closest<HTMLElement>("[data-att]") : null;
    // the note pressed: its card over the others'
    this.raise(d.note.id);
    this.press = {
      id: d.note.id,
      part,
      x: e.clientX,
      y: e.clientY,
      dot,
      moves: !dot && this.hooks.moves(dragKeyHeld(e)),
      moved: false,
      cam: { x: this.canvas.cam.x, y: this.canvas.cam.y },
      at: part === "icon" ? [d.at[0], d.at[1]] : [d.box!.x0, d.box!.y0],
      now: null,
      att: att ? Number(att.dataset.att) : null,
      menu: menuClick(e),
    };
    (part === "icon" ? d.icon : d.card).setPointerCapture(e.pointerId);
  }

  private move(e: PointerEvent): void {
    const p = this.press;
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!p.moved && dx * dx + dy * dy < DRAG_PX * DRAG_PX) return;
    p.moved = true;
    const d = this.drawn.get(p.id);
    if (p.moves && d) {
      // drawn there by the frame: the icon with its card, what would hold it lit, the others on the
      // ring making room as it leaves; or the card alone, on its leader
      p.now = [p.at[0] + dx, p.at[1] + dy];
      d.el.classList.add("dragging", p.part === "icon" ? "moving" : "hanging");
      this.canvas.request();
    } else {
      // in pan mode a drag on a note is a drag on the canvas
      const k = this.canvas.cam.k;
      this.canvas.cam.x = p.cam.x - dx / k;
      this.canvas.cam.y = p.cam.y - dy / k;
      this.canvas.request();
    }
  }

  private up(_e: PointerEvent): void {
    const p = this.press;
    this.press = null;
    this.target = null;
    this.zone = null;
    if (!p) return;
    const d = this.drawn.get(p.id);
    if (!d) return this.canvas.request();
    d.el.classList.remove("dragging", "moving", "hanging");
    if (p.moved) {
      if (p.moves && p.now && p.part === "icon") {
        // let go: the note's place is where its icon is — on a declaration, attached to it
        const to = this.dropFor(d, p.now);
        if (to) this.hooks.moved(p.id, to);
      } else if (p.moves && p.now && d.at) {
        // the card let go: its offset from the icon, never the note's place
        const [w, h] = this.cardSizeOf(d);
        this.hooks.card(p.id, d.kind, keptCard(d.at, [p.now[0] + w / 2, p.now[1] + h / 2], w, h));
      }
      this.canvas.request();
      return;
    }
    // a Mac's Ctrl+click is its right click: the note's menu opened on it, and it is no click
    if (p.menu) return;
    if (p.part === "card") {
      // a click on what it carries opens that, in the reference window: the note stays as it is
      const c = p.att !== null ? d.note.carries?.[p.att] : undefined;
      if (c) this.hooks.openCarry(d.note.id, c);
      return;
    }
    // a click on the icon: the note's own state toggled, for everyone; on a dot, or collapsed by the
    // zoom, the view goes near enough to read it instead
    if (markClick(p.dot ? 0 : d.t, d.look === "shut" && d.note.open) === "fly") this.flyTo(d.note.id);
    else this.hooks.setOpen(d.note.id, d.kind, !d.note.open);
  }

  /** Bring a note into view, near enough that it shows as its state says: its cluster large enough
   *  on the screen to hold its card, however small the cluster is (noteLook); attached to a
   *  declaration, the same of the cluster that holds the declaration. */
  flyTo(id: string): void {
    const d = this.drawn.get(id);
    if (!d) return;
    if (d.spot.at === "decl") {
      // the note and its declaration's point in the middle, at least as near as a click on a
      // declaration goes (a zoom of 1.1), and so near that its cluster is as large as a cluster's note
      // is flown to
      const s = this.spotWorld(d);
      if (!s?.point) return;
      const least = Math.max(1.1, s.level ? (AUTO_COLLAPSE_PX * 1.1) / Math.max(s.level.r, 1e-6) : 0);
      this.canvas.flyToPoint((s.x + s.point[0]) / 2, (s.y + s.point[1]) / 2, least);
    } else if (d.spot.at === "cluster" || d.spot.at === "offset") this.canvas.flyToCluster(d.spot.c, AUTO_COLLAPSE_PX * 1.1);
    else if (d.spot.at === "world") this.canvas.flyToPoint(d.spot.x, d.spot.y);
    else if (d.world) this.canvas.flyToPoint(d.world[0], d.world[1]);
    else if (this.ring) this.canvas.flyToPoint(this.ring.x, this.ring.y - this.ring.r);
  }

  /** Note `id`'s card brought in front of the others (shared/notecard.ts, raiseCard): the cards whose
   *  rank changed stacked again. */
  private raise(id: string): void {
    const was = this.stack;
    this.stack = raiseCard(was, id);
    for (const x of new Set([...was, ...this.stack])) this.stackCard(x);
  }

  /** Note `id`'s card at its place in the stack: in front by its rank, else among the others. */
  private stackCard(id: string): void {
    const d = this.drawn.get(id);
    if (d) d.card.style.zIndex = this.stack.includes(id) ? String(cardZ(this.stack, id)) : "";
  }

  /** How note `id` showed in the last frame: expanded, collapsed (by its state or by the zoom), or
   *  hidden; null where the board does not show it. */
  lookOf(id: string): "open" | "shut" | "hidden" | null {
    return this.drawn.get(id)?.look ?? null;
  }

  /** Whether the board on show shows note `id`. */
  has(id: string): boolean {
    return this.drawn.has(id);
  }

  /** Where a note is on the screen now: its card's top left corner, or its icon's where it shows no
   *  card; null when it does not show. */
  screenOf(id: string): { x: number; y: number } | null {
    const d = this.drawn.get(id);
    if (!d || d.look === "hidden" || !d.at) return null;
    return d.box ? { x: d.box.x0, y: d.box.y0 } : { x: d.at[0] - ICON_R, y: d.at[1] - ICON_R };
  }

  // ---------------------------------------------------------------- the editor

  /** Write a note, or edit one: a box at a point of the window, with its text; `done` is given
   *  the text (null: cancelled). Ctrl or ⌘ Enter, or Save, keeps it — the page names ⌘ on a Mac and
   *  Ctrl elsewhere — and Esc or Cancel does not. */
  edit(at: { x: number; y: number }, text: string, label: string, done: (text: string | null) => void): void {
    this.closeEditor();
    const box = document.createElement("form");
    box.className = "sticky-editor";
    box.innerHTML =
      `<div class="sk-ed-h">${NOTE_ICON}${escapeHtml(label)}</div>` +
      `<textarea maxlength="2000" rows="5" spellcheck="true" aria-label="The note's text" placeholder="What to look at here. **bold**, *italics*, \`code\`; a full name in backticks links to it."></textarea>` +
      `<div class="sk-ed-err" hidden></div>` +
      `<div class="sk-ed-f"><span class="muted">${MAC ? "⌘" : "Ctrl"} Enter to save · Esc to cancel</span><span class="vm-actions"><button type="button" class="rv-btn" data-sk-cancel>Cancel</button><button type="submit" class="rv-btn primary">Save</button></span></div>`;
    const area = box.querySelector("textarea")!;
    area.value = text;
    // above the floating windows: a note is written from the reference window too (Clip to a note)
    document.body.append(box);
    this.editor = box;
    const finish = (t: string | null) => {
      this.closeEditor();
      done(t);
    };
    const save = () => {
      const t = area.value.trim();
      if (!t) {
        const err = box.querySelector<HTMLElement>(".sk-ed-err")!;
        err.textContent = "A note needs text.";
        err.hidden = false;
        return;
      }
      finish(t);
    };
    box.addEventListener("submit", (e) => {
      e.preventDefault();
      save();
    });
    box.querySelector("[data-sk-cancel]")!.addEventListener("click", () => finish(null));
    box.addEventListener("keydown", (e) => {
      // the editor's keys are its own: none reaches the page's shortcuts
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        finish(null);
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !composing(e)) {
        e.preventDefault();
        save();
      }
    });
    const w = box.offsetWidth, h = box.offsetHeight;
    box.style.transform = `translate(${Math.round(Math.max(8, Math.min(at.x, innerWidth - w - 8)))}px, ${Math.round(Math.max(8, Math.min(at.y, innerHeight - h - 8)))}px)`;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  }

  /** Another board: its notes are what is there, none of them new. */
  reset(): void {
    this.closeEditor();
    for (const d of this.drawn.values()) d.el.remove();
    this.drawn.clear();
    for (const el of this.markers.values()) el.remove();
    this.markers.clear();
    this.rendered = false;
  }

  get editing(): boolean {
    return this.editor !== null;
  }

  closeEditor(): void {
    this.editor?.remove();
    this.editor = null;
  }
}
