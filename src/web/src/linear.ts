// The linear form (ExportSpec decision 18, the owner's decisions of 2026-10-13 and 2026-10-14): the
// board drawn as its document's outline. Every circle's centre and every point is on one vertical
// line, in the document's order, the first at the top; a section's circle still holds what it holds,
// stacked along the line, each level of nesting one more circle around it — the indentation. Only
// what the document prints is drawn: its sections, numbered as the PDF numbers them, its
// declarations of the project and its notes. Labels are on the right of the line, indented by
// depth; edges, where the board draws them, are arcs on its left, orange at the end that uses and
// blue at the end used, as the board's are.
//
// It is drawn on a layer of its own over the board (#linear), from the outline the server gives
// (GET /api/export/outline: the same plan and the same board order as the document,
// shared/doc/outline.ts), easing from where the board draws each thing to its place on the line,
// and back. The board under it is unchanged by it.
//
// A section folds (its ▸, or a double click on its heading) into one row that stands for all it
// holds, the edges of its members ending at it; one of more than FOLD_MORE items starts folded,
// and one the selection is in opens when the form does. What the document starts with, under no
// heading, has one here ("In no section"), which folds the same; it is no section of the document.
// What is folded is the reader's own. The wheel zooms about the pointer as far as the board's does;
// a drag on empty room pans.
//
// The right click opens the board's menu (ViewSpec decision 21) on what a row is — a declaration, a
// section's cluster, a note — or on the board where it is on none: Fold folds a section here; a
// note written from it goes right after the row (a section's: first in it), where the board would
// read it there. A click on a note opens it or closes it, its text under it, as on the board (its
// open state is the note's own, shared).
//
// What the pointer is on is the row whose point and name it is over, from the point to the name's end
// (a folded section's count, an open note's card): lit while it is, it is what a click selects, a
// drag takes and the right click opens the menu on (the owner's words of 2026-10-14: predictable).
// Elsewhere a drag pans and the right click opens the board's menu.
//
// Dragging a declaration, a note or a section by its point or its label moves it among its siblings,
// never out of its section, whatever the board's lock. A note attached to a declaration moves with
// it; dragged on its own and let go anywhere but right after it, it is attached no more, a note of
// the section where it is let go (the document reads an attached note right after its declaration). As on the board, what is dragged follows the
// pointer, off the line if the pointer goes there, and its siblings make room where it would go,
// easing aside; at the edges the line scrolls. Let go, it settles on the line in that room and is
// put on the board between its new neighbours, as a drop there would put it (web/src/canvas.ts,
// orderSpot): a pin, for everyone on the view; a note moved within its cluster. The document's
// order follows, and the outline is asked for again.

import type { Outline, OutlineDecl, OutlineItem, OutlineNote, OutlineSection } from "../../shared/doc/outline.ts";
import { SITE_BODY, SITE_STMT } from "../../shared/graph.ts";
import { ZOOM_LEAST, ZOOM_MOST } from "../../shared/sticky.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import { boardOrder } from "../../shared/doc/order.ts";
import type { GraphCanvas, OrderBody, PinMove } from "./canvas.ts";
import { LEAF_R } from "./scene.ts";
import { onThemeChange, reducedMotion } from "./theme.ts";

export interface LinearHooks {
  /** the outline of the board on show, or why there is none */
  outline(): Promise<Outline | string>;
  /** the board's graph: the canvas's numbering */
  graph(): Graph;
  /** where note `id`'s icon is drawn now, in the board's world; null where it does not show */
  noteSpot(id: string): [number, number] | null;
  /** whether declaration `i` (the canvas's numbering) is selected or lit, drawn larger */
  lit(i: number): boolean;
  /** whether the board draws edge u → v (of sites `site`) lit (canvas.edgeLit) */
  edgeLit(u: number, v: number, site: number): boolean;
  /** the key graph's edges the board draws under Keys, pairs of nodes; null where it does not */
  keyLinks(): readonly number[] | null;
  selectDecl(i: number, shift: boolean): void;
  selectSection(c: number, shift: boolean): void;
  /** why nothing on the board can be moved now (a snapshot, a read-only page, a past build's
   *  preview), or null */
  frozen(): string | null;
  /** whether the board draws its edges */
  edges(): boolean;
  /** put a note at a spot of the board in its cluster (null: none), as a drag would; `detach`: no
   *  longer attached to its declaration */
  moveNote(id: string, key: string | null, world: [number, number], detach?: boolean): boolean;
  /** a note's text, and whether it is open (its own state, shared) */
  noteText(id: string): string | null;
  noteOpen(id: string): boolean;
  /** open a note, or close it, for everyone, as on the board */
  toggleNote(id: string): void;
  say(text: string): void;
  /** the room taken at the right of the board beyond its panels (the Export window) */
  beside?(): number;
  /** the form was shown or put away */
  changed(on: boolean): void;
  /** the board's menu, at a point of the screen, on what a row is (null: the board), and where on
   *  the board a note written from it goes, now (null: where the board's would) */
  menu(on: MenuOn | null, x: number, y: number, spot: [number, number] | null): void;
}

/** What the linear form's menu is open on: a declaration (the canvas's numbering), a section's
 *  cluster (folded here or not), a note. */
export type MenuOn = { kind: "decl"; i: number } | { kind: "cluster"; c: number; key: string; folded: boolean } | { kind: "note"; id: string };

/** A row's height, the room a point and its label take on the line, and the room a section's
 *  circle keeps below what it holds, in the form's units (screen pixels at its zoom 1). */
const ROW = 22;
const PAD = 8;
/** how far a label is from the line, and its indent per level */
const LABEL_AT = 16;
const INDENT = 14;
/** the room a section's ▸ takes before its title */
const TRI = 13;
/** an open note's text: a line's height, how wide it is set, and the most lines shown */
const LINE = 16;
const NOTE_W = 420;
const NOTE_LINES = 14;
const DOT = 4;
const EASE_MS = 480;
/** how fast a row eases to where it goes while rows make room (ms, the time constant) */
const SLIDE_MS = 70;
/** how near the top or the bottom a drag scrolls the line, and how fast (px per ms at the edge) */
const EDGE_PX = 48;
const EDGE_SPEED = 0.9;
/** the most arcs drawn for the whole outline; past it, only those of what is lit */
const ARCS_MOST = 6000;
/** a section of more items than this starts folded (the owner's decision of 2026-10-14) */
const FOLD_MORE = 10;
/** the key of the heading the start of the document has here, which no cluster's key can be */
const START = "\u0000start";

/** One thing on the line: a declaration's or a note's row, or a section's span (its heading on the
 *  first row). `group` is the list it is ordered in — its siblings — and `at` its place there. */
interface Row {
  kind: "decl" | "note" | "section";
  /** a declaration's index (the canvas's numbering), a section's cluster index — the innermost of
   *  the circles it stands for, where the document reads its place; -1 for a note */
  k: number;
  /** a section's outermost circle, which moves it on the board */
  move?: number;
  name: string;
  label: string;
  depth: number;
  /** top and bottom of what it takes on the line, and its centre */
  y0: number;
  y1: number;
  cy: number;
  item: OutlineItem;
  group: OutlineItem[];
  /** the section it is in (its key), null at the top */
  in: string | null;
  /** attached to a declaration, read with it: not moved on its own */
  attached?: true;
  /** a folded section: the declarations it stands for (the canvas's numbering) */
  members?: number[];
  /** the heading of the start of the document, which is no section: neither moved nor selected */
  start?: true;
  /** an open note: its text, set in lines under its row */
  lines?: string[];
  /** where the board drew it when the form eased in: centre and radius on the screen */
  from?: [number, number, number];
}

/** What a reorder does on the board: declarations and circles pinned at spots, notes moved to spots. */
interface Plan {
  pins: PinMove[];
  notes: [Row, [number, number]][];
}

/** A row's name among the rows, kept from one outline to the next. */
const keyOf = (r: Row) => `${r.kind}:${r.name}`;

/** Why the form is shown: the Export window is open, the reader asked for it (⋯, the key), or the
 *  reader they follow shows it. */
type Why = "export" | "reader" | "followed";

/** Ease in and out. */
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class LinearForm {
  private el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private canvas: GraphCanvas;
  private hooks: LinearHooks;
  /** why it is shown: the Export window is open, the reader asked for it, or the reader they follow
   *  shows it (kept once following ends: CollabSpec decision 4) */
  private why = new Set<Why>();
  private outline: Outline | null = null;
  private rows: Row[] = [];
  /** the rows in order down the line, sections by their heading */
  private byY: Row[] = [];
  /** each declaration a folded section holds: the section's row, which stands for it */
  private under = new Map<number, Row>();
  /** the arcs last worked out (arcPairs), and what from */
  private arcsOf: { from: unknown[]; pairs: { a: Row; b: Row; lit: boolean; key?: true }[] } | null = null;
  /** the sections the reader folded (true) or opened (false), by key; the others as FOLD_MORE says */
  private folds = new Map<string, boolean>();
  private height = 0;
  /** 0: the board; 1: the line. Eases between them. */
  private t = 0;
  private target = 0;
  private last = 0;
  private frame = 0;
  /** the form's camera: the line's top at `y` of the outline, `k` its zoom */
  private cam = { y: 0, k: 1 };
  private press: { x: number; y: number; row: Row | null; moved: boolean; moves: boolean; camY: number } | null = null;
  /** a row being dragged: its block (it and what it holds or carries), its siblings and its place
   *  among them, how tall its block is, where it was taken (in the outline, and on the screen), the
   *  pointer, and where it would go (`at`, among its siblings with it) */
  private drag: { row: Row; block: Row[]; sibs: Row[]; blocks: Row[][]; from: number; h: number; grabY: number; grabX: number; px: number; py: number; at: number } | null = null;
  /** where a row is drawn off its place on the line, by its key: `dy` in the outline's units, `dx`
   *  on the screen, easing to `ty`, `tx` */
  private off = new Map<string, { dy: number; dx: number; ty: number; tx: number }>();
  /** the row the pointer is on, by its key (keyOf): lit */
  private hover: string | null = null;
  private turn = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private dpr = 1;

  constructor(el: HTMLCanvasElement, canvas: GraphCanvas, hooks: LinearHooks) {
    this.el = el;
    this.ctx = el.getContext("2d")!;
    this.canvas = canvas;
    this.hooks = hooks;
    el.addEventListener("pointerdown", (e) => this.down(e));
    el.addEventListener("pointermove", (e) => this.move(e));
    el.addEventListener("pointerup", (e) => this.up(e));
    el.addEventListener("pointercancel", () => this.cancel());
    el.addEventListener("pointerleave", () => this.setHover(null));
    el.addEventListener("dblclick", (e) => this.dbl(e));
    el.addEventListener("contextmenu", (e) => this.context(e));
    el.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    window.addEventListener("resize", () => this.request());
    // what it drew is in the theme's colours, read as it draws: drawn again in the new theme's
    onThemeChange(() => this.request());
  }

  get shown(): boolean {
    return this.why.size > 0;
  }

  /** Whether the reader asked for it (⋯, the key), or has it from a reader they follow or followed:
   *  ⋯ and the key put it away. */
  get asked(): boolean {
    return this.why.has("reader") || this.why.has("followed");
  }

  /** Whether it shows as a followed reader's does, or did when following ended. */
  get followed(): boolean {
    return this.why.has("followed");
  }

  /** Show it, for the Export window, at the reader's asking, or as a followed reader's. */
  async show(why: Why): Promise<void> {
    const was = this.shown;
    this.why.add(why);
    if (was) return;
    const turn = ++this.turn;
    const o = await this.hooks.outline();
    if (turn !== this.turn || !this.shown) return;
    if (typeof o === "string") {
      this.why.clear();
      this.hooks.say(o);
      return;
    }
    this.setOutline(o, true);
    this.fromBoard();
    this.cam = { y: this.startY(), k: 1 };
    this.el.hidden = false;
    this.ease(1);
    this.hooks.changed(true);
  }

  /** Put it away, for each of `whys`; the board comes back once nothing asks for it. */
  hide(...whys: Why[]): void {
    const was = this.shown;
    for (const w of whys) this.why.delete(w);
    if (!was || this.shown) return;
    this.turn++;
    this.press = null;
    this.drag = null;
    this.off.clear();
    this.fromBoard();
    this.ease(0);
    this.hooks.changed(false);
  }

  toggle(): void {
    if (this.asked) this.hide("reader", "followed");
    else void this.show("reader");
  }

  /** The board changed (a pin, a note, another build, another board): the outline is asked for
   *  again, a moment later. */
  refresh(): void {
    if (!this.shown) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      const turn = ++this.turn;
      void this.hooks.outline().then((o) => {
        if (turn !== this.turn || !this.shown || typeof o === "string") return;
        // not under a drag: it comes once that is let go
        if (this.drag) return this.refresh();
        const before = this.drawnAt();
        this.setOutline(o);
        this.settleFrom(before);
        this.request();
      });
    }, 350);
  }

  /** Draw again (the scheme, the theme, the selection changed). */
  request(): void {
    if (!this.el.hidden && !this.frame) this.frame = requestAnimationFrame((now) => this.draw(now));
  }

  // ---------------------------------------------------------------- the outline on the line

  /** Whether a section is folded: as the reader left it, else folded when it holds many. */
  private isFolded(key: string, items: number): boolean {
    return this.folds.get(key) ?? items > FOLD_MORE;
  }

  /** The rows of the outline, down the line. `reveal`: the sections a lit declaration is folded in
   *  are opened (the form opening on the selection). */
  private setOutline(o: Outline, reveal = false): void {
    this.outline = o;
    const g = this.hooks.graph();
    const clusterOf = new Map(this.canvas.layout.clusters.map((c, k) => [c.key, k]));
    const rows: Row[] = [];
    const under = new Map<number, Row>();
    const open = new Set<string>();
    let y = 0;
    const note = (n: OutlineNote, depth: number, group: OutlineItem[], inKey: string | null, attached: boolean) => {
      const lines = this.hooks.noteOpen(n.id) ? this.setText(this.hooks.noteText(n.id) ?? n.words ?? "") : [];
      // open, its text is its row: a card from the row's top, in its label's place
      const h = lines.length ? Math.max(ROW, lines.length * LINE + 8) : ROW;
      rows.push({ kind: "note", k: -1, name: n.id, label: n.words || "Note", depth, y0: y, y1: y + h, cy: y + ROW / 2, item: n, group, in: inKey, ...(attached ? { attached: true as const } : {}), ...(lines.length ? { lines } : {}) });
      y += h;
    };
    /** `fold`: the folded section the walk is in, which stands for all it holds; `path`: the keys
     *  of the sections around; `group`: the list the items are ordered in */
    const walk = (items: OutlineItem[], depth: number, inKey: string | null, fold: Row | null, path: string[], group = items) => {
      for (const it of items) {
        if (it.t === "decl") {
          const i = g.byName.get(it.name);
          if (fold) {
            if (i !== undefined) {
              under.set(i, fold);
              fold.members!.push(i);
              if (reveal && this.hooks.lit(i)) for (const key of path) open.add(key);
            }
            continue;
          }
          rows.push({ kind: "decl", k: i ?? -1, name: it.name, label: it.name.slice(it.name.lastIndexOf(".") + 1) || it.name, depth, y0: y, y1: y + ROW, cy: y + ROW / 2, item: it, group, in: inKey });
          y += ROW;
          for (const n of it.notes ?? []) note(n, depth + 1, group, inKey, true);
        } else if (it.t === "note") {
          if (!fold) note(it, depth, group, inKey, false);
        } else {
          const s: OutlineSection = it;
          const inside = [...path, s.key];
          if (fold) {
            walk(s.items, depth + 1, s.key, fold, inside);
            continue;
          }
          const folded = this.isFolded(s.key, s.items.length);
          const row: Row = { kind: "section", k: clusterOf.get(s.key) ?? -1, move: clusterOf.get(s.keys[0]) ?? -1, name: s.key, label: `${s.number ? `${s.number}  ` : ""}${s.title}`, depth, y0: y, y1: 0, cy: 0, item: s, group, in: inKey, ...(folded ? { members: [] } : {}) };
          rows.push(row);
          y += ROW;
          if (folded) walk(s.items, depth + 1, s.key, row, inside);
          else {
            walk(s.items, depth + 1, s.key, null, inside);
            y += PAD;
          }
          row.y1 = y;
          row.cy = folded ? row.y0 + ROW / 2 : (row.y0 + row.y1) / 2;
        }
      }
    };
    // the start of the document, under a heading of its own here, then the sections
    const start = o.items.filter((it) => it.t !== "section");
    if (start.length) {
      const folded = this.isFolded(START, start.length);
      const row: Row = { kind: "section", k: -1, name: START, label: "In no section", depth: 0, y0: y, y1: 0, cy: 0, item: start[0], group: o.items, in: null, start: true, ...(folded ? { members: [] } : {}) };
      rows.push(row);
      y += ROW;
      if (folded) walk(start, 0, null, row, [START], o.items);
      else {
        walk(start, 0, null, null, [START], o.items);
        y += PAD;
      }
      row.y1 = y;
      row.cy = row.y0 + ROW / 2;
    }
    walk(
      o.items.filter((it) => it.t === "section"),
      0,
      null,
      null,
      [],
      o.items,
    );
    if (open.size) {
      for (const key of open) this.folds.set(key, false);
      return this.setOutline(o);
    }
    // what was drawn where the board had it keeps that, to ease from
    const before = new Map(this.rows.map((r) => [`${r.kind}:${r.name}`, r.from]));
    for (const r of rows) r.from = before.get(`${r.kind}:${r.name}`);
    this.rows = rows;
    this.byY = rows;
    this.under = under;
    this.height = y;
  }

  /** A note's text in lines NOTE_W wide, its Markdown marks left out, at most NOTE_LINES. */
  private setText(text: string): string[] {
    const c = this.ctx;
    c.font = `12px ${FONT}`;
    const plain = text.replace(/\*\*|`/g, "").replace(/(^|\s)\*(\S[^*]*)\*/g, "$1$2");
    const out: string[] = [];
    for (const para of plain.split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (line && (c.measureText(next).width ?? 0) > NOTE_W) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out.length > NOTE_LINES ? [...out.slice(0, NOTE_LINES - 1), `${out[NOTE_LINES - 1]} …`] : out;
  }

  /** Fold the section of cluster `key` here, or open it (the menu's Fold). */
  toggleFold(key: string): void {
    const r = this.rows.find((x) => x.kind === "section" && x.name === key);
    if (r) this.fold(r);
  }

  /** The whole line on the screen (the menu's Fit). */
  fit(): void {
    const v = this.view();
    this.cam = { y: 0, k: Math.min(1, Math.max(ZOOM_LEAST, (v.h - v.top - 24) / Math.max(this.height, 1))) };
    this.request();
  }

  /** Fold a section, or open it; its heading stays where it is on the screen. */
  private fold(r: Row): void {
    if (r.kind !== "section" || !this.outline) return;
    this.folds.set(r.name, !r.members);
    this.setOutline(this.outline);
    const now = this.rows.find((x) => x.kind === "section" && x.name === r.name);
    if (now) this.cam.y += now.y0 - r.y0;
    this.clampCam();
    this.request();
  }

  /** Where the board draws each row now, on the screen: what the form eases from and to. */
  private fromBoard(): void {
    const C = this.canvas;
    for (const r of this.rows) {
      if (r.kind === "decl" && r.k >= 0) {
        const [sx, sy] = C.toScreen(...C.posOf(r.k));
        r.from = [sx, sy, DOT];
      } else if (r.kind === "section") {
        const d = C.clusterDisc(r.name);
        r.from = d ?? undefined;
      } else if (r.kind === "note") {
        const w = this.hooks.noteSpot(r.name);
        r.from = w ? [...C.toScreen(w[0], w[1]), DOT] : undefined;
      }
    }
  }

  /** Where the line is opened first: the selection, else the top. */
  private startY(): number {
    const lit = this.rows.find((r) => r.kind === "decl" && r.k >= 0 && this.hooks.lit(r.k));
    return lit ? Math.max(0, lit.cy - this.view().h / 3) : 0;
  }

  /** The room the form has: the canvas's, less what covers it; the line where it reads well. */
  private view(): { w: number; h: number; x: number; top: number } {
    const { w, h, insets } = this.canvas.screen;
    const free = w - insets.left - Math.max(insets.right, this.hooks.beside?.() ?? 0);
    return { w, h, x: insets.left + Math.max(140, free * 0.4), top: insets.top + 24 };
  }

  private ease(to: number): void {
    this.target = to;
    // with reduced motion it comes and goes at once (theme.ts, reducedMotion)
    if (reducedMotion()) this.t = to;
    this.last = performance.now();
    this.el.hidden = false;
    this.request();
  }

  // ---------------------------------------------------------------- drawing

  private draw(now: number): void {
    this.frame = 0;
    // the rows' slides and the scroll step 50 ms a frame at most, never jumping; the form's coming
    // and going by the time gone, so that it takes its 480 ms however slowly the screen draws (the
    // pointer is not heard until it has come)
    const elapsed = Math.max(0, now - this.last);
    const dt = Math.min(elapsed, 50);
    this.last = now;
    // rows making room, or settling, ease to where they go
    if (this.off.size) {
      const a = reducedMotion() ? 1 : 1 - Math.exp(-dt / SLIDE_MS);
      let moving = false;
      for (const [key, o] of this.off) {
        o.dy += (o.ty - o.dy) * a;
        o.dx += (o.tx - o.dx) * a;
        if (Math.abs(o.ty - o.dy) < 0.2 && Math.abs(o.tx - o.dx) < 0.2) {
          o.dy = o.ty;
          o.dx = o.tx;
          if (!o.ty && !o.tx) this.off.delete(key);
        } else moving = true;
      }
      if (moving) this.request();
    }
    // a drag near the top or the bottom scrolls the line
    const d = this.drag;
    if (d) {
      const v = this.view();
      const room = (v.h - v.top) / this.cam.k;
      // only where there is more of the outline beyond the edge
      const edge = d.py < v.top + EDGE_PX && this.cam.y > 0 ? -1 : d.py > v.h - EDGE_PX && this.cam.y + room < this.height ? 1 : 0;
      if (edge) {
        this.cam.y += (edge * EDGE_SPEED * dt) / this.cam.k;
        this.clampCam();
        this.follow(d.px, d.py);
        this.request();
      }
    }
    if (this.t !== this.target) {
      const step = elapsed / EASE_MS;
      this.t = this.target > this.t ? Math.min(this.target, this.t + step) : Math.max(this.target, this.t - step);
      this.request();
    }
    // the board under it fades as the line comes
    const board = 1 - ease(this.t);
    for (const id of ["canvas", "labels", "cards", "stickies"]) {
      const e = document.getElementById(id);
      if (e) e.style.opacity = board >= 0.999 ? "" : String(board);
    }
    if (this.t === 0 && this.target === 0) {
      this.el.hidden = true;
      this.arcsOf = null;
      return;
    }
    this.paint();
  }

  /** A folded section holds something lit. */
  private litIn(r: Row): boolean {
    return !!r.members?.some((i) => this.hooks.lit(i));
  }

  /** Where a row's label starts on the screen (a section's ▸ before it). */
  private labelX(r: Row): number {
    return this.view().x + LABEL_AT + r.depth * INDENT;
  }

  private fontOf(r: Row, lit: boolean): string {
    return r.kind === "section" ? `600 13px ${FONT}` : r.kind === "note" ? `italic 12px ${FONT}` : `${lit ? "600 " : ""}12px ${FONT}`;
  }

  private paint(): void {
    const { w, h } = this.canvas.screen;
    const dpr = window.devicePixelRatio || 1;
    if (this.el.width !== Math.round(w * dpr) || this.el.height !== Math.round(h * dpr) || this.dpr !== dpr) {
      this.el.width = Math.round(w * dpr);
      this.el.height = Math.round(h * dpr);
      this.el.style.width = `${w}px`;
      this.el.style.height = `${h}px`;
      this.dpr = dpr;
    }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const cs = getComputedStyle(document.body);
    const css = (v: string) => cs.getPropertyValue(v).trim();
    const v = this.view();
    const k = this.cam.k;
    const p = ease(this.t);
    const sy = (y: number) => v.top + (y - this.cam.y) * k;
    const onScreen = (y0: number, y1: number) => sy(y1) > -40 && sy(y0) < h + 40;
    // where a row is drawn off its place on the line: making room, settling, or dragged
    const oy = (r: Row) => this.off.get(keyOf(r))?.dy ?? 0;
    const ox = (r: Row) => this.off.get(keyOf(r))?.dx ?? 0;
    const shown = (r: Row, y0: number, y1: number) => onScreen(y0 + oy(r), y1 + oy(r));
    // the line's place for a row, eased from the board's
    const at = (r: Row, y: number, rad: number): [number, number, number] => {
      const f = r.from;
      const x = v.x + ox(r), yy = sy(y + oy(r));
      if (!f || p >= 1) return [x, yy, rad];
      return [lerp(f[0], x, p), lerp(f[1], yy, p), lerp(f[2], rad, p)];
    };

    // the sections' circles, outermost first; a folded one a disc on its heading's row
    const circles = (rows: Row[]) => {
      c.lineWidth = 1;
      for (const r of rows) {
        if (r.kind !== "section" || !shown(r, r.y0, r.y1) || (r.start && !r.members)) continue;
        const folded = !!r.members;
        const [x, y, rad] = at(r, r.cy, folded ? Math.max(3, (ROW / 2 - 3) * k) : ((r.y1 - r.y0) / 2) * k);
        c.beginPath();
        c.arc(x, y, Math.max(rad, 1), 0, 2 * Math.PI);
        c.fillStyle = folded ? css("--disc-line") || "rgba(127,127,127,0.4)" : css("--disc") || "rgba(127,127,127,0.06)";
        c.globalAlpha = folded ? 0.45 : 0.55;
        c.fill();
        c.globalAlpha = 1;
        const lit = folded && this.litIn(r);
        c.strokeStyle = lit ? css("--accent") : css("--disc-line") || "rgba(127,127,127,0.4)";
        c.lineWidth = lit ? 2 : 1;
        c.stroke();
        c.lineWidth = 1;
      }
    };

    // the points, the notes' marks, the open sections' heads on the line
    const points = (rows: Row[]) => {
      for (const r of rows) {
        const y = r.kind === "section" ? r.y0 + ROW / 2 : r.cy;
        if (!shown(r, y - ROW, y + ROW)) continue;
        const lit = r.kind === "decl" && r.k >= 0 && this.hooks.lit(r.k);
        if (r.kind === "decl") {
          const [x, yy, rad] = at(r, y, (lit ? DOT + 1.5 : DOT) * Math.min(1, Math.max(0.6, k)));
          c.beginPath();
          c.arc(x, yy, rad, 0, 2 * Math.PI);
          c.fillStyle = r.k >= 0 ? this.canvas.colourOf(r.k) : css("--text-2");
          c.fill();
          if (lit) {
            c.strokeStyle = css("--accent");
            c.lineWidth = 2;
            c.stroke();
            c.lineWidth = 1;
          }
        } else if (r.kind === "note") {
          const [x, yy] = at(r, y, DOT);
          // a note's mark, in the colour of its icon on the board
          c.fillStyle = css("--note-bg");
          c.strokeStyle = css("--note-icon") || css("--accent");
          c.lineWidth = 1.5;
          c.beginPath();
          c.roundRect(x - 4.5, yy - 4.5, 9, 9, 2);
          c.fill();
          c.stroke();
          c.lineWidth = 1;
        } else if (!r.members && (p >= 1 || !r.from)) {
          // where the section's circle meets the line at its top: its heading's mark
          c.fillStyle = css("--disc-line");
          c.beginPath();
          c.arc(v.x + ox(r), sy(r.y0 + ROW / 2 + oy(r)), 2.5, 0, 2 * Math.PI);
          c.fill();
        }
      }
    };

    // the labels, once the line is there; zoomed out, the sections' titles alone, where there is
    // room for them
    const labels = (rows: Row[]) => {
      if (p <= 0.5) return;
      const all = ROW * k >= 11;
      c.globalAlpha = (p - 0.5) / 0.5;
      c.textBaseline = "middle";
      let last = -Infinity;
      for (const r of rows) {
        if (!all && r.kind !== "section") continue;
        const y = r.kind === "section" ? r.y0 + ROW / 2 : r.cy;
        if (!shown(r, y - ROW, y + ROW)) continue;
        const yy = sy(y + oy(r));
        if (!all) {
          if (yy - last < 16) continue;
          last = yy;
        }
        let x = this.labelX(r) + ox(r);
        const lit = r.kind === "decl" ? r.k >= 0 && this.hooks.lit(r.k) : r.kind === "section" && this.litIn(r);
        if (r.kind === "section") {
          c.fillStyle = css("--text-2");
          triangle(c, x, yy, !r.members);
          x += TRI;
        }
        c.font = r.start ? `italic 600 13px ${FONT}` : this.fontOf(r, lit);
        c.fillStyle = r.kind === "section" ? (lit ? css("--accent") : css("--text")) : lit ? css("--accent") : r.kind === "note" ? css("--text-2") : css("--label") || css("--text");
        if (!r.lines) c.fillText(r.label, x, yy);
        if (r.members) {
          // what a folded section holds
          const wl = c.measureText(r.label).width;
          c.font = `12px ${FONT}`;
          c.fillStyle = css("--text-3");
          c.fillText(`${r.members.length}`, x + wl + 8, yy);
        }
        if (r.lines && all) {
          // an open note's text, in a card under its row, as large as the zoom lets its lines be
          const size = Math.min(12, LINE * k * 0.75);
          if (size >= 7) {
            const top = sy(r.y0 + 3 + oy(r)), h = r.lines.length * LINE * k + 6 * k;
            c.save();
            c.globalAlpha *= 0.9;
            c.fillStyle = css("--note-bg") || "rgba(255,240,180,0.6)";
            c.beginPath();
            c.roundRect(x - 6, top, NOTE_W + 12, h, 6);
            c.fill();
            c.restore();
            c.font = `${size}px ${FONT}`;
            c.fillStyle = css("--text");
            r.lines.forEach((line, j) => c.fillText(line, x, top + 3 * k + (j + 0.5) * LINE * k));
          }
        }
      }
      c.globalAlpha = 1;
    };

    // what is dragged is drawn last, lifted over the rest
    const lifted = this.drag?.block ?? [];
    const held = new Set(lifted);
    const still = held.size ? this.rows.filter((r) => !held.has(r)) : this.rows;
    circles(still);
    if (this.hooks.edges() && p > 0.6) this.arcs(c, (r) => [v.x + ox(r), sy(r.cy + oy(r))], (p - 0.6) / 0.4, css);
    // the row the pointer is on: its point and its name, lit
    const on = this.hover && !this.drag ? this.rows.find((r) => keyOf(r) === this.hover) : undefined;
    if (on && p >= 1) {
      const top = sy(on.y0 + oy(on)), bottom = sy((on.kind === "section" ? on.y0 + ROW : on.y1) + oy(on));
      const x0 = v.x - 12 + ox(on), x1 = this.nameEnd(on) + 8 + ox(on);
      c.save();
      c.fillStyle = css("--accent");
      c.globalAlpha = 0.1;
      c.beginPath();
      c.roundRect(x0, top + 1, x1 - x0, Math.max(4, bottom - top - 2), 6);
      c.fill();
      c.globalAlpha = 0.35;
      c.strokeStyle = css("--accent");
      c.stroke();
      c.restore();
    }
    points(still);
    labels(still);
    if (lifted.length) {
      c.save();
      c.shadowColor = "rgba(0, 0, 0, 0.18)";
      c.shadowBlur = 14;
      circles(lifted);
      points(lifted);
      c.restore();
      labels(lifted);
    }
  }

  /** The arcs to draw, once per pair of rows: the edges between what the outline prints, from the
   *  one that uses to the one it uses, a folded section's members' ending at its row; each lit as
   *  the board lights it (canvas.edgeLit: between two lit declarations, of the sites the mode
   *  follows), so that the line and the board say the same. Under the Keys step, the board's key
   *  graph instead lights its own links, dashed (`key`). Worked out again only when the graph, the
   *  rows, the key links or what the board lights (its lit set and mode, which edgeLit answers from
   *  and canvas.setActivation sets anew) changed, not at every frame: on NavierStokesAndEuler's
   *  Project view, 61,000 rows and 5 million edges, that was 130 ms a frame. */
  private arcPairs(): { a: Row; b: Row; lit: boolean; key?: true }[] {
    const g = this.hooks.graph();
    const from = [g, this.rows, this.under, this.hooks.keyLinks(), this.canvas.active, this.canvas.mode];
    if (this.arcsOf && from.every((x, i) => x === this.arcsOf!.from[i])) return this.arcsOf.pairs;
    const rowOf = new Map<number, Row>();
    for (const r of this.rows) if (r.kind === "decl" && r.k >= 0) rowOf.set(r.k, r);
    for (const [i, r] of this.under) rowOf.set(i, r);
    const sites = SITE_STMT | SITE_BODY;
    const pairs = new Map<string, { a: Row; b: Row; lit: boolean; key?: true }>();
    for (const [u, ru] of rowOf) {
      for (let e = g.outStart[u]; e < g.outStart[u + 1]; e++) {
        const t = g.outDst[e];
        if (!(g.outSite[e] & sites)) continue;
        const rt = rowOf.get(t);
        if (!rt || rt === ru) continue;
        const lit = this.hooks.edgeLit(u, t, g.outSite[e]);
        const key = `${ru.y0}:${rt.y0}`;
        const was = pairs.get(key);
        if (was) was.lit ||= lit;
        else pairs.set(key, { a: ru, b: rt, lit });
      }
    }
    const links = this.hooks.keyLinks();
    const out = [...pairs.values()];
    if (links) {
      const seen = new Set<string>();
      for (let j = 0; j + 1 < links.length; j += 2) {
        const ra = rowOf.get(links[j]), rb = rowOf.get(links[j + 1]);
        if (!ra || !rb || ra === rb || seen.has(`${ra.y0}:${rb.y0}`)) continue;
        seen.add(`${ra.y0}:${rb.y0}`);
        out.push({ a: ra, b: rb, lit: true, key: true });
      }
    }
    this.arcsOf = { from, pairs: out };
    return out;
  }

  /** The arcs on the left of the line, orange at the end that uses and blue at the end used, as on
   *  the board; the lit drawn bolder, a key link dashed. Past ARCS_MOST, only the lit. */
  private arcs(c: CanvasRenderingContext2D, pos: (r: Row) => [number, number], alpha: number, css: (v: string) => string): void {
    const pairs = this.arcPairs();
    const few = pairs.length <= ARCS_MOST;
    const { h } = this.canvas.screen;
    const from = css("--edge-from") || "rgba(240,110,20,0.85)";
    const to = css("--edge-to") || "rgba(59,91,219,0.85)";
    for (const { a, b, lit, key } of pairs) {
      if (!few && !lit) continue;
      const [xa, ya] = pos(a), [xb, yb] = pos(b);
      if ((ya < -20 && yb < -20) || (ya > h + 20 && yb > h + 20)) continue;
      const bulge = Math.min(Math.abs(yb - ya) * 0.5, 600);
      const left = Math.min(xa, xb) - bulge;
      const grad = c.createLinearGradient(xa, ya, xb, yb);
      grad.addColorStop(0, from);
      grad.addColorStop(1, to);
      c.strokeStyle = grad;
      c.lineWidth = lit ? 1.8 : 1;
      c.globalAlpha = alpha * (lit ? 0.95 : 0.35);
      c.setLineDash(key ? [5, 4] : []);
      c.beginPath();
      c.moveTo(xa, ya);
      c.bezierCurveTo(left, ya, left, yb, xb, yb);
      c.stroke();
    }
    c.setLineDash([]);
    c.lineWidth = 1;
    c.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- the pointer

  /** The row at a point of the screen: the one at its height (a section by its heading's row) whose
   *  point and name it is over, from a little left of the line to a little past the name's end. */
  private rowAt(px: number, py: number): Row | null {
    const v = this.view();
    const y = this.cam.y + (py - v.top) / this.cam.k;
    for (const r of this.byY) {
      const top = r.y0, bottom = r.kind === "section" ? r.y0 + ROW : r.y1;
      if (y >= top && y < bottom) return px >= v.x - 12 && px <= this.nameEnd(r) + 8 ? r : null;
    }
    return null;
  }

  /** Where a row's name ends on the screen: its label (a section's ▸ before it, a folded one's count
   *  after it), an open note's card. */
  private nameEnd(r: Row): number {
    const x = this.labelX(r);
    if (r.lines) return x + NOTE_W;
    const c = this.ctx;
    c.font = r.start ? `italic 600 13px ${FONT}` : this.fontOf(r, r.kind === "decl" && r.k >= 0 && this.hooks.lit(r.k));
    let end = x + (r.kind === "section" ? TRI : 0) + (c.measureText(r.label).width ?? 0);
    if (r.members) {
      c.font = `12px ${FONT}`;
      end += 8 + (c.measureText(`${r.members.length}`).width ?? 0);
    }
    return end;
  }

  /** The row the pointer is on, lit; drawn again where it changed. */
  private setHover(r: Row | null): void {
    const key = r ? keyOf(r) : null;
    if (key === this.hover) return;
    this.hover = key;
    this.request();
  }

  /** The point is on a section's ▸. */
  private onTriangle(r: Row, px: number): boolean {
    if (r.kind !== "section") return false;
    const x = this.labelX(r);
    return px >= x - 4 && px < x + TRI - 2;
  }

  private down(e: PointerEvent): void {
    if (this.t < 1 || e.button !== 0) return;
    const row = this.rowAt(e.offsetX, e.offsetY);
    if (row && this.onTriangle(row, e.offsetX)) return this.fold(row);
    this.el.setPointerCapture(e.pointerId);
    this.press = { x: e.offsetX, y: e.offsetY, row, moved: false, moves: !!row && !row.start, camY: this.cam.y };
  }

  private move(e: PointerEvent): void {
    const pr = this.press;
    if (!pr) {
      const row = this.t < 1 ? null : this.rowAt(e.offsetX, e.offsetY);
      this.setHover(row);
      this.el.style.cursor = !row ? "" : this.onTriangle(row, e.offsetX) || row.start || this.hooks.frozen() ? "pointer" : "grab";
      return;
    }
    if (!pr.moved && Math.hypot(e.offsetX - pr.x, e.offsetY - pr.y) < 4) return;
    pr.moved = true;
    if (pr.row && pr.moves && !this.hooks.frozen()) {
      if (!this.drag) this.lift(pr.row, pr.x, pr.y);
      this.follow(e.offsetX, e.offsetY);
      this.el.style.cursor = "grabbing";
    } else {
      // the line pans
      this.cam.y = pr.camY - (e.offsetY - pr.y) / this.cam.k;
      this.clampCam();
    }
    this.request();
  }

  private up(e: PointerEvent): void {
    const pr = this.press;
    this.press = null;
    if (!pr) return;
    if (!pr.moved) {
      const r = pr.row;
      if (r?.kind === "decl" && r.k >= 0) this.hooks.selectDecl(r.k, e.shiftKey);
      else if (r?.kind === "section" && r.k >= 0) this.hooks.selectSection(r.k, e.shiftKey);
      else if (r?.kind === "note") {
        this.hooks.toggleNote(r.name);
        this.refresh();
      }
      this.request();
      return;
    }
    const d = this.drag;
    this.drag = null;
    if (pr.row && pr.moves) {
      const why = this.hooks.frozen();
      if (why) this.hooks.say(why);
      if (why || !d) this.settle();
      else {
        // where everything is drawn now, to settle from once the rows are in their new order
        const before = this.drawnAt();
        if (this.place(d)) this.settleFrom(before);
        else this.settle();
      }
    }
    this.el.style.cursor = "";
    this.request();
  }

  /** The right click: the board's menu on the row the pointer is on (lit), else the board's own. */
  private context(e: MouseEvent): void {
    e.preventDefault();
    if (this.t < 1) return;
    const row = this.rowAt(e.offsetX, e.offsetY);
    const on: MenuOn | null = !row
      ? null
      : row.kind === "decl"
        ? row.k >= 0
          ? { kind: "decl", i: row.k }
          : null
        : row.kind === "note"
          ? { kind: "note", id: row.name }
          : row.start || row.k < 0
            ? null
            : { kind: "cluster", c: row.k, key: row.name, folded: !!row.members };
    this.hooks.menu(on, e.clientX, e.clientY, row ? this.noteSpot(row) : null);
  }

  /** Where on the board, now, a note goes to come right after a row in the document, clear of what
   *  is around so that the board settling again keeps it there: halfway between the row and the
   *  next in its section (the board reads the lowest first), or halfway to the top of the section's
   *  circle after the last; a section's, first in it: halfway between what it starts with and the
   *  bottom of its circle. Null where the board does not draw it. */
  private noteSpot(r: Row): [number, number] | null {
    const R = this.canvas.atRest();
    const C = this.canvas;
    const disc = (key: string | null) => {
      const c = key === null ? -1 : C.layout.clusters.findIndex((x) => x.key === key);
      return c < 0 ? null : { y: R.cy[c], r: R.r[c] };
    };
    if (r.kind === "section") {
      // first in it: below what it starts with, inside it
      const items = r.start ? (this.outline?.items ?? []).filter((it) => it.t !== "section") : (r.item as OutlineSection).items;
      const key = r.start ? null : r.name;
      const first = items[0];
      if (!first) return null;
      const g = this.hooks.graph();
      let at: [number, number] | null = null;
      if (first.t === "decl") {
        const i = g.byName.get(first.name);
        at = i === undefined ? null : [R.nx[i], R.ny[i]];
      } else if (first.t === "note") {
        const n = this.hooks.noteSpot(first.id);
        if (n) at = [this.toRest(key, n, R).x, this.toRest(key, n, R).y];
      } else {
        const c = C.layout.clusters.findIndex((x) => x.key === first.key);
        if (c >= 0) at = [R.cx[c], R.cy[c] + R.r[c]];
      }
      if (!at) return null;
      const d = disc(key);
      const bottom = d ? d.y + d.r : at[1] + 40;
      return C.restToNow(key, [at[0], (at[1] + bottom) / 2], R);
    }
    const here = this.spotOf(r, R);
    if (!here) return null;
    const sibs = this.siblings(r);
    const next = sibs[sibs.indexOf(r) + 1];
    const there = next ? this.spotOf(next, R) : null;
    let y: number;
    if (there && Math.abs(there[1] - here[1]) >= 1) y = (here[1] + there[1]) / 2;
    else if (there) return C.restToNow(r.in, [(here[0] + there[0]) / 2, here[1]], R);
    else {
      const d = disc(r.in);
      y = (here[1] + (d ? d.y - d.r : here[1] - 40)) / 2;
    }
    return C.restToNow(r.in, [here[0], y], R);
  }

  /** A double click on a section's heading folds or opens it, as on the board. */
  private dbl(e: MouseEvent): void {
    if (this.t < 1) return;
    const row = this.rowAt(e.offsetX, e.offsetY);
    if (row?.kind === "section" && !this.onTriangle(row, e.offsetX)) this.fold(row);
  }

  private cancel(): void {
    this.press = null;
    this.drag = null;
    this.settle();
    this.request();
  }

  /** The wheel zooms about the pointer, as far either way as the board's does. */
  private wheel(e: WheelEvent): void {
    if (this.t < 1) return;
    e.preventDefault();
    const v = this.view();
    const y = this.cam.y + (e.offsetY - v.top) / this.cam.k;
    this.cam.k = Math.min(ZOOM_MOST, Math.max(ZOOM_LEAST, this.cam.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016))));
    this.cam.y = y - (e.offsetY - v.top) / this.cam.k;
    this.clampCam();
    this.request();
  }

  private clampCam(): void {
    const v = this.view();
    const room = (v.h - v.top) / this.cam.k;
    this.cam.y = Math.min(Math.max(this.cam.y, -room / 2), Math.max(0, this.height - room / 2));
  }

  // ---------------------------------------------------------------- moving along the line

  /** A point of the screen's height, in the outline's units. */
  private layoutY(py: number): number {
    return this.cam.y + (py - this.view().top) / this.cam.k;
  }

  /** A row and what goes with it: a section's rows inside it, a declaration's attached notes. */
  private blockOf(r: Row): Row[] {
    const out = [r];
    for (let j = this.rows.indexOf(r) + 1; j < this.rows.length; j++) {
      const x = this.rows[j];
      if (r.kind === "section" ? x.y0 < r.y1 && x.depth > r.depth : x.attached === true && x.depth > r.depth) out.push(x);
      else break;
    }
    return out;
  }

  /** Take a row up, where it was pressed: it, and what goes with it, follow the pointer. */
  private lift(row: Row, px: number, py: number): void {
    const sibs = this.siblings(row);
    // it takes what goes with it (a section's rows, a declaration's notes); an attached note taken
    // up leaves its declaration's block
    const blocks = sibs.map((r) => (r === row ? this.blockOf(row) : this.blockOf(r).filter((x) => x !== row)));
    const from = sibs.indexOf(row);
    const block = blocks[from] ?? [row];
    const h = Math.max(...block.map((r) => r.y1)) - row.y0;
    this.drag = { row, block, sibs, blocks, from, h, grabY: this.layoutY(py), grabX: px, px, py, at: from };
  }

  /** The pointer moved with a row taken up: the row follows it; its siblings make room where it
   *  would go, before the first whose middle is below its heading. */
  private follow(px: number, py: number): void {
    const d = this.drag;
    if (!d) return;
    d.px = px;
    d.py = py;
    const dy = this.layoutY(py) - d.grabY, dx = px - d.grabX;
    const head = d.row.y0 + ROW / 2 + dy;
    let at = d.sibs.length;
    for (let i = 0; i < d.sibs.length; i++) {
      if (i === d.from) continue;
      const b = d.blocks[i];
      if (head < (b[0].y0 + Math.max(...b.map((r) => r.y1))) / 2) {
        at = i;
        break;
      }
    }
    d.at = at;
    for (const r of d.block) this.off.set(keyOf(r), { dy, dx, ty: dy, tx: dx });
    d.sibs.forEach((_, i) => {
      if (i === d.from) return;
      const shift = d.from < i && i < at ? -d.h : at <= i && i < d.from ? d.h : 0;
      for (const r of d.blocks[i]) this.slide(r, shift);
    });
  }

  /** Ease a row to `ty` off its place on the line. */
  private slide(r: Row, ty: number): void {
    const o = this.off.get(keyOf(r));
    if (o) {
      o.ty = ty;
      o.tx = 0;
    } else if (ty) this.off.set(keyOf(r), { dy: 0, dx: 0, ty, tx: 0 });
  }

  /** Where each row is drawn now, in the outline's units, and how far off the line. */
  private drawnAt(): Map<string, { y: number; dx: number }> {
    return new Map(this.rows.map((r) => [keyOf(r), { y: r.y0 + (this.off.get(keyOf(r))?.dy ?? 0), dx: this.off.get(keyOf(r))?.dx ?? 0 }]));
  }

  /** The rows came in another order: each eases from where it was drawn to its new place. */
  private settleFrom(before: Map<string, { y: number; dx: number }>): void {
    for (const r of this.rows) {
      const b = before.get(keyOf(r));
      if (b && (Math.abs(b.y - r.y0) > 0.5 || b.dx)) this.off.set(keyOf(r), { dy: b.y - r.y0, dx: b.dx, ty: 0, tx: 0 });
      else this.off.delete(keyOf(r));
    }
  }

  /** Everything off its place on the line eases back to it. */
  private settle(): void {
    for (const o of this.off.values()) o.ty = o.tx = 0;
  }

  /** The rows ordered with `row`, it among them, in order. A note attached to a declaration is
   *  among its section's rows where it is read, right after its declaration. */
  private siblings(row: Row): Row[] {
    const top = row.in === null;
    const sibs = this.rows.filter((r) => r.group === row.group && !r.attached && !r.start && (!top || (r.kind === "section") === (row.kind === "section")));
    if (!row.attached) return sibs;
    const decl = this.declOf(row);
    const at = decl ? sibs.indexOf(decl) + 1 : sibs.length;
    return [...sibs.slice(0, at), row, ...sibs.slice(at)];
  }

  /** The declaration's row an attached note's row is under. */
  private declOf(row: Row): Row | null {
    for (let j = this.rows.indexOf(row) - 1; j >= 0; j--) {
      const r = this.rows[j];
      if (r.kind === "decl" && r.group === row.group && r.depth === row.depth - 1) return r;
      if (!r.attached) return null;
    }
    return null;
  }

  /** Let go: the section's order made so on the board, as exactly as the board allows (`plans`),
   *  or nothing, and the reader told why; the outline follows. Whether it was put there. */
  private place(d: { row: Row; at: number }): boolean {
    const sibs = this.siblings(d.row);
    const from = sibs.indexOf(d.row);
    let to = d.at;
    if (to > from) to--;
    if (to === from || from < 0) return false;
    const rest = sibs.filter((r) => r !== d.row);
    const prev = to > 0 ? rest[to - 1] : null;
    const next = to < rest.length ? rest[to] : null;
    const R = this.canvas.atRest();
    const order = [...rest];
    order.splice(to, 0, d.row);
    const plans = this.plans(d.row, order, sibs, Math.min(from, to), Math.max(from, to), prev, next, R);
    const plan = plans.find((p) => p && this.holds(p, order, R));
    if (!plan) {
      this.hooks.say(plans.some(Boolean) ? "There is no room for it there on the board: move it on the board." : "That cannot be moved from here: move it on the board.");
      return false;
    }
    if (plan.pins.length && !this.canvas.pinAtSpots(plan.pins, R)) return false;
    for (const [r, spot] of plan.notes) if (!this.hooks.moveNote(r.name, r.in, this.canvas.restToNow(r.in, spot, R), r.attached)) return false;
    // at once here; the server's outline follows. An attached note, let go elsewhere, is one of the
    // section's
    const items = d.row.group;
    const it = d.row.item;
    const nextItem = next?.item ?? null;
    const owner = d.row.attached ? (this.declOf(d.row)?.item as OutlineDecl | undefined) : undefined;
    if (owner) owner.notes = owner.notes?.filter((n) => n !== it);
    else items.splice(items.indexOf(it), 1);
    items.splice(nextItem ? items.indexOf(nextItem) : prev ? items.indexOf(prev.item) + 1 : items.length, 0, it);
    if (this.outline) this.setOutline(this.outline);
    this.refresh();
    return true;
  }

  /** Where a row is on the board at rest (`R`), a note where it is drawn now; null where it is not. */
  private spotOf(r: Row, R: ReturnType<GraphCanvas["atRest"]>): [number, number] | null {
    if (r.kind === "decl") return r.k >= 0 ? [R.nx[r.k], R.ny[r.k]] : null;
    if (r.kind === "section") return r.k >= 0 ? [R.cx[r.k], R.cy[r.k]] : null;
    const s = this.hooks.noteSpot(r.name);
    if (!s) return null;
    const t = this.toRest(r.in, s, R);
    return [t.x, t.y];
  }

  /** A row put at a spot: a pin for a declaration or a circle, a move for a note. */
  private put(plan: Plan, r: Row, spot: [number, number]): void {
    if (r.kind === "note") plan.notes.push([r, spot]);
    else plan.pins.push({ a: r.kind === "decl" ? { kind: "node", k: r.k } : { kind: "cluster", k: r.k, ...(r.move !== undefined && r.move >= 0 ? { move: r.move } : {}) }, spot });
  }

  /** The ways to make `order` the board's order, the least change first (the owner's decision of
   *  2026-10-14: the rest of the section keeps its places); a note dragged is put between its new
   *  neighbours first, as nothing on the board makes way for a note:
   *  - each row from `lo` to `hi` to the place the row at its index had (`was`): nothing else moves
   *    and, the rows being of a size, none lands on another;
   *  - the dragged row alone between its new neighbours, as a drop there would put it;
   *  - the rows from `lo` to `hi` stacked in their new order down the height they took, each where
   *    it is across: what a large circle needs where the others are small.
   *  Null where one cannot be made (a row the board does not draw). */
  private plans(row: Row, order: Row[], was: Row[], lo: number, hi: number, prev: Row | null, next: Row | null, R: ReturnType<GraphCanvas["atRest"]>): (Plan | null)[] {
    const ok = (r: Row) => r.kind === "note" || r.k >= 0;
    const reseat = (): Plan | null => {
      const plan: Plan = { pins: [], notes: [] };
      for (let j = lo; j <= hi; j++) {
        if (order[j] === was[j]) continue;
        const spot = this.spotOf(was[j], R);
        if (!spot || !ok(order[j])) return null;
        this.put(plan, order[j], spot);
      }
      return plan;
    };
    const between = (): Plan | null => {
      const disc = (r: Row | null): OrderBody | null => {
        if (!r) return null;
        const s = this.spotOf(r, R);
        if (!s || !ok(r)) return null;
        return r.kind === "decl" ? { kind: "node", k: r.k } : r.kind === "section" ? { kind: "cluster", k: r.k } : { kind: "spot", x: s[0], y: s[1] };
      };
      const [a, p, n] = [disc(row), disc(prev), disc(next)];
      if (!a || (prev && !p) || (next && !n)) return null;
      const spot = this.canvas.orderSpot(a, p, n, R);
      if (!spot) return null;
      const plan: Plan = { pins: [], notes: [] };
      this.put(plan, row, spot);
      return plan;
    };
    const stack = (): Plan | null => {
      const radius = (r: Row) => (r.kind === "section" ? R.r[r.k] : LEAF_R);
      const run = order.slice(lo, hi + 1);
      const at = run.map((r) => this.spotOf(r, R));
      if (at.some((s, j) => !s || !ok(run[j]))) return null;
      // the board's first is its lowest: down the run's height, the first at its bottom
      let bottom = Math.max(...run.map((r, j) => at[j]![1] + radius(r)));
      const plan: Plan = { pins: [], notes: [] };
      run.forEach((r, j) => {
        const y = bottom - radius(r);
        bottom = y - radius(r) - 2.5;
        this.put(plan, r, [at[j]![0], y]);
      });
      return plan;
    };
    return row.kind === "note" ? [between(), reseat(), stack()] : [reseat(), between(), stack()];
  }

  /** Whether the board would give `order` were `plan` made, as the server reads it. */
  private holds(plan: Plan, order: Row[], R: ReturnType<GraphCanvas["atRest"]>): boolean {
    const S = this.canvas.atRestWith(plan.pins, R);
    const moved = new Map(plan.notes);
    const at = (r: Row): [number, number] | null => (r.kind === "note" ? (moved.get(r) ?? this.spotOf(r, R)) : this.spotOf(r, S));
    const got = boardOrder(order, at);
    return got.every((r, j) => r === order[j]);
  }

  /** A spot of the board where it is drawn now, as at rest: the inverse of the canvas's restToNow. */
  private toRest(key: string | null, spot: [number, number], R: ReturnType<GraphCanvas["atRest"]>): { x: number; y: number } {
    const there = this.canvas.restToNow(key, [0, 0], R);
    return { x: spot[0] - there[0], y: spot[1] - there[1] };
  }
}

/** A section's ▸ (folded) or ▾ (open), its left edge at `x`, centred on `y`. */
function triangle(c: CanvasRenderingContext2D, x: number, y: number, open: boolean): void {
  c.beginPath();
  if (open) {
    c.moveTo(x, y - 2.5);
    c.lineTo(x + 8, y - 2.5);
    c.lineTo(x + 4, y + 3);
  } else {
    c.moveTo(x + 1.5, y - 4);
    c.lineTo(x + 7, y);
    c.lineTo(x + 1.5, y + 4);
  }
  c.closePath();
  c.fill();
}

const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", sans-serif`;
