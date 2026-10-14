// The linear form (ExportSpec decision 18, the owner's decisions of 2026-10-13 and 2026-10-14): the
// board drawn as its document's outline. Every circle's centre and every point is on one vertical
// line, in the document's order, the first at the top; a section's circle still holds what it holds,
// stacked along the line, each level of nesting one more circle around it — the indentation. Only
// what the document prints is drawn: its sections, numbered as the PDF numbers them, its
// declarations of the project and its notes. Labels are on the right of the line, indented by
// depth; edges, where the board draws them, are arcs on its left.
//
// It is drawn on a layer of its own over the board (#linear), from the outline the server gives
// (GET /api/export/outline: the same plan and the same board order as the document,
// shared/doc/outline.ts), easing from where the board draws each thing to its place on the line,
// and back. The board under it is unchanged by it.
//
// Dragging a declaration, a note or a section along the line moves it among its siblings, never out
// of its section. Let go, it is put on the board between its new neighbours, as a drop there would
// put it (web/src/canvas.ts, orderSpot): a pin, for everyone on the view; a note moved within its
// cluster. The document's order follows, and the outline is asked for again.

import type { Outline, OutlineItem, OutlineNote, OutlineSection } from "../../shared/doc/outline.ts";
import { SITE_BODY, SITE_PROOF, SITE_STMT } from "../../shared/graph.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import type { GraphCanvas, OrderBody } from "./canvas.ts";

export interface LinearHooks {
  /** the outline of the board on show, or why there is none */
  outline(): Promise<Outline | string>;
  /** the board's graph: the canvas's numbering */
  graph(): Graph;
  /** where note `id`'s icon is drawn now, in the board's world; null where it does not show */
  noteSpot(id: string): [number, number] | null;
  /** whether declaration `i` (the canvas's numbering) is selected or lit, drawn larger */
  lit(i: number): boolean;
  selectDecl(i: number, shift: boolean): void;
  selectSection(c: number, shift: boolean): void;
  /** why nothing on the board can be moved now (a snapshot, a read-only page, a past build's
   *  preview), or null */
  frozen(): string | null;
  /** whether a drag that starts with this event moves what it starts on (the lock, the drag key) */
  moves(e: PointerEvent): boolean;
  /** the edges the board draws, and its proof edges */
  edges(): { show: boolean; proofs: boolean };
  /** put a note at a spot of the board in its cluster (null: none), as a drag would */
  moveNote(id: string, key: string | null, world: [number, number]): boolean;
  say(text: string): void;
  /** the room taken at the right of the board beyond its panels (the Export window) */
  beside?(): number;
  /** the form was shown or put away */
  changed(on: boolean): void;
}

/** A row's height, the room a point and its label take on the line, and the room a section's
 *  circle keeps below what it holds, in the form's units (screen pixels at its zoom 1). */
const ROW = 22;
const PAD = 8;
/** how far a label is from the line, and its indent per level */
const LABEL_AT = 16;
const INDENT = 14;
const DOT = 4;
const EASE_MS = 480;
/** the most arcs drawn for the whole outline; past it, only those of what is lit */
const ARCS_MOST = 6000;

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
  /** where the board drew it when the form eased in: centre and radius on the screen */
  from?: [number, number, number];
}

/** Ease in and out. */
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class LinearForm {
  private el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private canvas: GraphCanvas;
  private hooks: LinearHooks;
  /** why it is shown: the Export window is open, the reader asked for it */
  private why = new Set<"export" | "reader">();
  private outline: Outline | null = null;
  private rows: Row[] = [];
  /** the rows in order down the line, sections by their heading */
  private byY: Row[] = [];
  private height = 0;
  /** 0: the board; 1: the line. Eases between them. */
  private t = 0;
  private target = 0;
  private last = 0;
  private frame = 0;
  /** the form's camera: the line's top at `y` of the outline, `k` its zoom */
  private cam = { y: 0, k: 1 };
  private press: { x: number; y: number; row: Row | null; moved: boolean; moves: boolean; camY: number } | null = null;
  /** where a dragged row would go: its index among its siblings */
  private drop: { row: Row; at: number; y: number } | null = null;
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
    el.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    window.addEventListener("resize", () => this.request());
  }

  get shown(): boolean {
    return this.why.size > 0;
  }

  /** Whether the reader asked for it (⋯, the key), as followers take it. */
  get asked(): boolean {
    return this.why.has("reader");
  }

  /** Show it, for the Export window or at the reader's asking. */
  async show(why: "export" | "reader"): Promise<void> {
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
    this.setOutline(o);
    this.fromBoard();
    this.cam = { y: this.startY(), k: 1 };
    this.el.hidden = false;
    this.ease(1);
    this.hooks.changed(true);
  }

  /** Put it away, for `why`; the board comes back once nothing asks for it. */
  hide(why: "export" | "reader"): void {
    if (!this.why.delete(why) || this.shown) return;
    this.turn++;
    this.press = null;
    this.drop = null;
    this.fromBoard();
    this.ease(0);
    this.hooks.changed(false);
  }

  toggle(): void {
    if (this.asked) this.hide("reader");
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
        this.setOutline(o);
        this.request();
      });
    }, 350);
  }

  /** Draw again (the scheme, the theme, the selection changed). */
  request(): void {
    if (!this.el.hidden && !this.frame) this.frame = requestAnimationFrame((now) => this.draw(now));
  }

  // ---------------------------------------------------------------- the outline on the line

  private setOutline(o: Outline): void {
    this.outline = o;
    const g = this.hooks.graph();
    const clusterOf = new Map(this.canvas.layout.clusters.map((c, k) => [c.key, k]));
    const rows: Row[] = [];
    let y = 0;
    const note = (n: OutlineNote, depth: number, group: OutlineItem[], inKey: string | null, attached: boolean) => {
      rows.push({ kind: "note", k: -1, name: n.id, label: n.words || "Note", depth, y0: y, y1: y + ROW, cy: y + ROW / 2, item: n, group, in: inKey, ...(attached ? { attached: true as const } : {}) });
      y += ROW;
    };
    const walk = (items: OutlineItem[], depth: number, inKey: string | null) => {
      for (const it of items) {
        if (it.t === "decl") {
          const i = g.byName.get(it.name);
          rows.push({ kind: "decl", k: i ?? -1, name: it.name, label: it.name.slice(it.name.lastIndexOf(".") + 1) || it.name, depth, y0: y, y1: y + ROW, cy: y + ROW / 2, item: it, group: items, in: inKey });
          y += ROW;
          for (const n of it.notes ?? []) note(n, depth + 1, items, inKey, true);
        } else if (it.t === "note") note(it, depth, items, inKey, false);
        else {
          const s: OutlineSection = it;
          const row: Row = { kind: "section", k: clusterOf.get(s.key) ?? -1, move: clusterOf.get(s.keys[0]) ?? -1, name: s.key, label: `${s.number ? `${s.number}  ` : ""}${s.title}`, depth, y0: y, y1: 0, cy: 0, item: s, group: items, in: inKey };
          rows.push(row);
          y += ROW;
          walk(s.items, depth + 1, s.key);
          y += PAD;
          row.y1 = y;
          row.cy = (row.y0 + row.y1) / 2;
        }
      }
    };
    walk(o.items, 0, null);
    // what was drawn where the board had it keeps that, to ease from
    const before = new Map(this.rows.map((r) => [`${r.kind}:${r.name}`, r.from]));
    for (const r of rows) r.from = before.get(`${r.kind}:${r.name}`);
    this.rows = rows;
    this.byY = rows;
    this.height = y;
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
    this.last = performance.now();
    this.el.hidden = false;
    this.request();
  }

  // ---------------------------------------------------------------- drawing

  private draw(now: number): void {
    this.frame = 0;
    const dt = now - this.last;
    this.last = now;
    if (this.t !== this.target) {
      const step = dt / EASE_MS;
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
      return;
    }
    this.paint();
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
    // the line's place for a row, eased from the board's
    const at = (r: Row, y: number, rad: number): [number, number, number] => {
      const f = r.from;
      if (!f || p >= 1) return [v.x, sy(y), rad];
      return [lerp(f[0], v.x, p), lerp(f[1], sy(y), p), lerp(f[2], rad, p)];
    };

    // the sections' circles, outermost first
    c.lineWidth = 1;
    for (const r of this.rows) {
      if (r.kind !== "section" || !onScreen(r.y0, r.y1)) continue;
      const [x, y, rad] = at(r, r.cy, ((r.y1 - r.y0) / 2) * k);
      c.beginPath();
      c.arc(x, y, Math.max(rad, 1), 0, 2 * Math.PI);
      c.fillStyle = css("--disc") || "rgba(127,127,127,0.06)";
      c.globalAlpha = 0.55;
      c.fill();
      c.globalAlpha = 1;
      c.strokeStyle = css("--disc-line") || "rgba(127,127,127,0.4)";
      c.stroke();
    }

    // the edges, arcs on the left of the line
    const e = this.hooks.edges();
    if (e.show && p > 0.6) this.arcs(c, v, sy, e.proofs, (p - 0.6) / 0.4, css);

    // the points, the notes' marks, the sections' heads on the line
    for (const r of this.rows) {
      const y = r.kind === "section" ? r.y0 + ROW / 2 : r.cy;
      if (!onScreen(y - ROW, y + ROW)) continue;
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
      } else if (p >= 1 || !r.from) {
        // where the section's circle meets the line at its top: its heading's mark
        c.fillStyle = css("--disc-line");
        c.beginPath();
        c.arc(v.x, sy(r.y0 + ROW / 2), 2.5, 0, 2 * Math.PI);
        c.fill();
      }
    }

    // the labels, once the line is there
    if (p > 0.5 && ROW * k >= 11) {
      c.globalAlpha = (p - 0.5) / 0.5;
      c.textBaseline = "middle";
      for (const r of this.rows) {
        const y = r.kind === "section" ? r.y0 + ROW / 2 : r.cy;
        if (!onScreen(y - ROW, y + ROW)) continue;
        const x = v.x + LABEL_AT + r.depth * INDENT;
        const lit = r.kind === "decl" && r.k >= 0 && this.hooks.lit(r.k);
        c.font = r.kind === "section" ? `600 13px ${FONT}` : r.kind === "note" ? `italic 12px ${FONT}` : `${lit ? "600 " : ""}12px ${FONT}`;
        c.fillStyle = r.kind === "section" ? css("--text") : lit ? css("--accent") : r.kind === "note" ? css("--text-2") : css("--label") || css("--text");
        c.fillText(r.label, x, sy(y));
      }
      c.globalAlpha = 1;
    }

    // a row being dragged: where it would go
    const d = this.drop;
    if (d) {
      c.strokeStyle = css("--accent");
      c.lineWidth = 2;
      const x = v.x + LABEL_AT + d.row.depth * INDENT;
      c.beginPath();
      c.moveTo(v.x - 10, sy(d.y));
      c.lineTo(x + 180, sy(d.y));
      c.stroke();
      c.lineWidth = 1;
    }
  }

  /** The edges between what the outline prints, as arcs on the left of the line from the one that
   *  uses to the one it uses; past ARCS_MOST, only those of what is lit. */
  private arcs(c: CanvasRenderingContext2D, v: { x: number }, sy: (y: number) => number, proofs: boolean, alpha: number, css: (v: string) => string): void {
    const g = this.hooks.graph();
    const yOf = new Map<number, number>();
    for (const r of this.rows) if (r.kind === "decl" && r.k >= 0) yOf.set(r.k, r.cy);
    const sites = SITE_STMT | SITE_BODY | (proofs ? SITE_PROOF : 0);
    const all: [number, number, boolean][] = [];
    for (const [u, yu] of yOf) {
      for (let e = g.outStart[u]; e < g.outStart[u + 1]; e++) {
        const t = g.outDst[e];
        if (!(g.outSite[e] & sites)) continue;
        const yt = yOf.get(t);
        if (yt === undefined || t === u) continue;
        all.push([yu, yt, this.hooks.lit(u) || this.hooks.lit(t)]);
      }
    }
    const few = all.length <= ARCS_MOST;
    const { h } = this.canvas.screen;
    c.lineWidth = 1;
    for (const [a, b, lit] of all) {
      if (!few && !lit) continue;
      const ya = sy(a), yb = sy(b);
      if ((ya < -20 && yb < -20) || (ya > h + 20 && yb > h + 20)) continue;
      const bulge = Math.min(Math.abs(yb - ya) * 0.5, 600);
      c.strokeStyle = lit ? css("--accent") : css("--edge-from") || "rgba(127,127,127,0.35)";
      c.globalAlpha = alpha * (lit ? 0.9 : 0.35);
      c.beginPath();
      c.moveTo(v.x, ya);
      c.bezierCurveTo(v.x - bulge, ya, v.x - bulge, yb, v.x, yb);
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- the pointer

  /** The row at a point of the screen: its own row on the line or right of it; a section by its
   *  heading's row. */
  private rowAt(px: number, py: number): Row | null {
    const v = this.view();
    if (px < v.x - 24) return null;
    const y = this.cam.y + (py - v.top) / this.cam.k;
    for (const r of this.byY) {
      const top = r.y0, bottom = r.kind === "section" ? r.y0 + ROW : r.y1;
      if (y >= top && y < bottom) return r;
    }
    return null;
  }

  private down(e: PointerEvent): void {
    if (this.t < 1 || e.button !== 0) return;
    this.el.setPointerCapture(e.pointerId);
    const row = this.rowAt(e.offsetX, e.offsetY);
    this.press = { x: e.offsetX, y: e.offsetY, row, moved: false, moves: !!row && !row.attached && this.hooks.moves(e), camY: this.cam.y };
  }

  private move(e: PointerEvent): void {
    const pr = this.press;
    if (!pr) {
      const row = this.rowAt(e.offsetX, e.offsetY);
      this.el.style.cursor = row ? "pointer" : "";
      return;
    }
    if (!pr.moved && Math.hypot(e.offsetX - pr.x, e.offsetY - pr.y) < 4) return;
    pr.moved = true;
    if (pr.row && pr.moves && !this.hooks.frozen()) {
      this.drop = this.dropAt(pr.row, e.offsetY);
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
      this.request();
      return;
    }
    if (pr.row && pr.moves) {
      const why = this.hooks.frozen();
      if (why) this.hooks.say(why);
      else if (this.drop) this.place(this.drop);
    }
    this.drop = null;
    this.el.style.cursor = "";
    this.request();
  }

  private cancel(): void {
    this.press = null;
    this.drop = null;
    this.request();
  }

  private wheel(e: WheelEvent): void {
    if (this.t < 1) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const v = this.view();
      const y = this.cam.y + (e.offsetY - v.top) / this.cam.k;
      this.cam.k = Math.min(3, Math.max(0.3, this.cam.k * Math.exp(-e.deltaY * 0.002)));
      this.cam.y = y - (e.offsetY - v.top) / this.cam.k;
    } else this.cam.y += e.deltaY / this.cam.k;
    this.clampCam();
    this.request();
  }

  private clampCam(): void {
    const v = this.view();
    const room = (v.h - v.top) / this.cam.k;
    this.cam.y = Math.min(Math.max(this.cam.y, -room / 2), Math.max(0, this.height - room / 2));
  }

  // ---------------------------------------------------------------- moving along the line

  /** Where a row dragged to the pointer's height would go among its siblings: before the first
   *  whose middle is below the pointer. The start of the document and its sections are ordered
   *  apart (shared/doc/order.ts): a top-level row moves among those of its kind. */
  private dropAt(row: Row, py: number): { row: Row; at: number; y: number } {
    const y = this.cam.y + (py - this.view().top) / this.cam.k;
    const sibs = this.siblings(row);
    let at = sibs.length;
    for (let j = 0; j < sibs.length; j++) {
      if (y < sibs[j].cy) {
        at = j;
        break;
      }
    }
    const lineY = at < sibs.length ? sibs[at].y0 : sibs.length ? sibs[sibs.length - 1].y1 : row.y0;
    return { row, at, y: lineY };
  }

  /** The rows ordered with `row`, it among them, in order. */
  private siblings(row: Row): Row[] {
    const top = row.in === null;
    return this.rows.filter((r) => r.group === row.group && !r.attached && (!top || (r.kind === "section") === (row.kind === "section")));
  }

  /** Let go: put the row on the board between its new neighbours; the outline follows. */
  private place(d: { row: Row; at: number }): void {
    const sibs = this.siblings(d.row);
    const from = sibs.indexOf(d.row);
    let to = d.at;
    if (to > from) to--;
    if (to === from || from < 0) return;
    const rest = sibs.filter((r) => r !== d.row);
    const prev = to > 0 ? rest[to - 1] : null;
    const next = to < rest.length ? rest[to] : null;
    const C = this.canvas;
    const R = C.atRest();
    const body = (r: Row | null): OrderBody | null => {
      if (!r) return null;
      if (r.kind === "decl") return r.k >= 0 ? { kind: "node", k: r.k } : null;
      if (r.kind === "section") return r.k >= 0 ? { kind: "cluster", k: r.k } : null;
      const s = this.hooks.noteSpot(r.name);
      return s ? { kind: "spot", ...this.toRest(r.in, s, R) } : null;
    };
    const a = body(d.row);
    const [p, n] = [body(prev), body(next)];
    if (!a || (prev && !p) || (next && !n)) return this.hooks.say("That cannot be moved from here: move it on the board.");
    let ok = false;
    if (a.kind === "spot") {
      const spot = C.orderSpot(a, p, n, R);
      ok = !!spot && this.hooks.moveNote(d.row.name, d.row.in, C.restToNow(d.row.in, spot, R));
    } else ok = C.pinInOrder(a.kind === "cluster" && d.row.move !== undefined && d.row.move >= 0 ? { ...a, move: d.row.move } : a, p, n);
    if (!ok) return this.hooks.say("That could not be put there on the board.");
    // at once here; the server's outline follows
    const items = d.row.group;
    const it = d.row.item;
    const nextItem = next?.item ?? null;
    items.splice(items.indexOf(it), 1);
    items.splice(nextItem ? items.indexOf(nextItem) : prev ? items.indexOf(prev.item) + 1 : items.length, 0, it);
    if (this.outline) this.setOutline(this.outline);
    this.refresh();
  }

  /** A spot of the board where it is drawn now, as at rest: the inverse of the canvas's restToNow. */
  private toRest(key: string | null, spot: [number, number], R: ReturnType<GraphCanvas["atRest"]>): { x: number; y: number } {
    const there = this.canvas.restToNow(key, [0, 0], R);
    return { x: spot[0] - there[0], y: spot[1] - there[1] };
  }
}

const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", sans-serif`;
