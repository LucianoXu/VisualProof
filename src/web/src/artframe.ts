// The artwork mode (ExportSpec decision 19, the owner's decisions of 2026-10-14; the files are made
// in web/src/artwork.ts). The board is the picture: while the mode is on, the page draws the board
// itself with the artwork's settings (ArtHooks.look), moving or still, and everything done on the
// board works as ever. Over it, a viewfinder: a frame fixed in the middle of the room the panel
// leaves, of the shape of the size chosen, the rest of the screen shaded — what lies in it is the
// picture. The panel at the right sets the size and the look, applied to the board at once; Save PNG
// or Save SVG makes the file at the size chosen, in the browser. Esc or Done leaves, the board drawn
// as before. The mode is followed and shared (CollabSpec decision 4): what presence carries is its
// settings and the rectangle of the board's world its frame holds (`view`, `follow`). The reader's
// last settings are kept in their browser as the start of their next artwork.
//
// Names and targets by selection (the owner's decisions of 2026-10-15: many targets' stars and
// diamonds cover the picture): the targets marked are ticked in a list of the review's, all of them
// at first; the names written are ticked in a list of those the frame holds — the clusters', then the
// declarations' — under a filter, and the board's menu shows or hides a name. Names by selection
// start from As shown, and what is kept is what differs from it: the names hidden, and those shown
// besides (or, after None, from nothing). The key marks have a switch of their own.

import type { ArtworkView } from "../../shared/collab.ts";
import { ART_NAMES_BYTES, ART_TARGETS_BYTES } from "../../shared/collab.ts";
import { ZOOM_LEAST, ZOOM_MOST } from "../../shared/sticky.ts";
import type { ArtSettings, NameRow, NotePicture } from "./artwork.ts";
import { artName, chooseIn, artSvg, borderBand, borderInset, cleanSettings, drawBackdrop, drawBorder, drawFoot, drawNotes, drawTitle, encodePng, footMost, glyphSvg, MAX_SIDE, nameRows, oriented, PRESETS, presetOf, themeBackground, withChosen } from "./artwork.ts";
import type { GraphCanvas } from "./canvas.ts";
import { ART_DISPLAY, ART_SANS, ART_SERIF } from "./halo.ts";
import { FOOT_SIZE, TITLE_SIZE } from "../../shared/collab.ts";
import { escapeHtml } from "./highlight.ts";

export interface ArtHooks {
  /** the view's title, which names the file */
  title(): string;
  /** the settings this browser kept, and keeping them */
  saved(): Partial<ArtSettings> | undefined;
  save(s: ArtSettings): void;
  /** the page's colouring and theme now: a first artwork's */
  now(): { scheme: ArtSettings["scheme"]; theme: ArtSettings["theme"] };
  /** the board drawn with the artwork's settings and the panels put away; or as before (null) */
  look(s: ArtSettings | null): void;
  /** the artwork changed — on, off, its settings: those following are told */
  changed(): void;
  /** the notes as the board shows them now, on the screen */
  notes(): NotePicture[];
  /** the foot's line for the project's git source and the commit of the build on show; null where
   *  the project is no git repository */
  source(): string | null;
  /** every target of the review, by full name, with the name the board writes */
  targets(): { name: string; label: string }[];
  /** the title and its line where the reader gave none: the project's name, and what it holds */
  titles(): { title: string; subtitle: string };
  say(text: string): void;
}

/** the panel's width, and the room kept around the frame: at its sides, and above and below it for
 *  the strips set there (the title's, the source's) */
const PANEL_W = 300;
const MARGIN = 32;
const GAP = 12;
const HEAD_ROOM = 60;
const TAIL_ROOM = 34;
/** how long the mode takes to come and to go, as the linear form (web/src/linear.ts); and how long
 *  the board dips to its ground while its look changes */
const EASE_MS = 480;
const DIP_MS = 180;
/** the most pixels a band of a PNG is drawn in at once: what every browser's canvas allows */
const BAND_PIXELS = 4096 * 4096;

const sameLook = (a: ArtSettings, b: ArtSettings) =>
  (Object.keys(a) as (keyof ArtSettings)[]).every((k) => {
    const x = a[k], y = b[k];
    return Array.isArray(x) && Array.isArray(y) ? x.length === y.length && x.every((v, j) => v === y[j]) : x === y;
  });

/** What is said where a choice does not fit in what the artwork carries to those following. */
const NO_ROOM = (left: number, what: string) =>
  `${left === 1 ? `One ${what} did` : `${left} ${what}s did`} not fit in what the artwork carries to those following you: untick some to make room.`;

export class ArtFrame {
  private root: HTMLElement;
  private frameEl: HTMLElement;
  private sky: HTMLCanvasElement;
  private ink: HTMLCanvasElement;
  private head: HTMLElement;
  private tail: HTMLElement;
  /** those following are told of the title once it has been still a moment */
  private titleWait = 0;
  /** the mode's coming and going: each newer step's turn, which an older one's waits give way to; and
   *  whether it is going */
  private turn = 0;
  private leaving = false;
  private panel: HTMLElement;
  private canvas: GraphCanvas;
  private hooks: ArtHooks;
  private s: ArtSettings | null = null;
  /** the frame, on the screen */
  private rect = { x: 0, y: 0, w: 0, h: 0 };
  private busy = false;
  private measureCtx: CanvasRenderingContext2D | null = null;
  /** where the camera was before the mode: where the reader's Done takes it back */
  private before: { x: number; y: number; k: number } | null = null;
  /** the names the frame holds, for the list of names (canvas artNames), as last read from the board */
  private rows: NameRow[] = [];
  /** of them, those the board writes now: ticked */
  private wrote: ReadonlySet<string> = new Set();
  /** the reader's filter over that list: their own, not the artwork's */
  private filter = "";
  /** the list read again once the board has been still a moment; when it was read last */
  private rowsWait = 0;
  private rowsAt = 0;
  /** Esc leaves, unless it is a field's, a menu's or a dialog's */
  private onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    // in the filter over the names, Esc empties it first
    if (t instanceof HTMLInputElement && t.dataset.artFilter !== undefined && t.value) {
      e.preventDefault();
      e.stopPropagation();
      t.value = this.filter = "";
      return this.renderRows();
    }
    if (t && !this.panel.contains(t) && !this.root.contains(t) && t.closest?.("input, textarea, [contenteditable], [role=menu], [role=dialog], #modal")) return;
    if (document.querySelector("#ctxmenu:not([hidden])")) return;
    e.preventDefault();
    e.stopPropagation();
    this.close();
  };

  constructor(root: HTMLElement, panel: HTMLElement, sky: HTMLCanvasElement, canvas: GraphCanvas, hooks: ArtHooks) {
    this.root = root;
    this.panel = panel;
    this.sky = sky;
    this.canvas = canvas;
    this.hooks = hooks;
    // over the board within the frame, the title and the foot as the files have them (`ink`); under
    // it, the style's ground (`sky`)
    // in the shade beside the frame, where they act: the title's controls above its top left
    // (`head`), the source's switch below its bottom right (`tail`)
    root.innerHTML = `<div class="art-frame"><canvas class="art-ink"></canvas></div><div class="art-head glass" data-art-side></div><div class="art-tail glass" data-art-side></div>`;
    this.frameEl = root.querySelector(".art-frame")!;
    this.ink = root.querySelector(".art-ink")!;
    this.head = root.querySelector(".art-head")!;
    this.tail = root.querySelector(".art-tail")!;
    for (const host of [panel, this.head, this.tail]) {
      host.addEventListener("change", (e) => this.changed(e.target as HTMLInputElement));
      host.addEventListener("input", (e) => {
        const t = e.target as HTMLInputElement;
        // the title and its size, as they are typed and slid
        if (t.dataset.art === "title" || t.dataset.art === "subtitle" || t.dataset.art === "titleSize" || t.dataset.art === "footSize") return this.titled(t);
        if (t.dataset.artFilter === undefined) return;
        this.filter = t.value;
        this.renderRows();
      });
    }
    for (const host of [this.head, this.tail])
      host.addEventListener("click", (e) => {
        const t = e.target as HTMLElement;
        if (t.closest("[data-art-pick]")) this.pick(t.closest<HTMLElement>("[data-art-pick]")!.dataset.artPick!);
      });
    // the fonts arrive after the first drawing: drawn again with them
    document.fonts?.addEventListener?.("loadingdone", () => this.isOpen && this.renderInk());
    panel.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-art-done]")) this.close();
      else if (t.closest("[data-art-save]")) void this.saveFile(t.closest<HTMLElement>("[data-art-save]")!.dataset.artSave as "png" | "svg");
      else if (t.closest("[data-art-pick]")) this.pick(t.closest<HTMLElement>("[data-art-pick]")!.dataset.artPick!);
    });
    window.addEventListener("resize", () => this.isOpen && this.s && this.place(true));
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** The settings the board is drawn with: null where the mode is off. */
  get settings(): ArtSettings | null {
    return this.s;
  }

  /** Whether the name of what `id` names (shared/collab.ts, artNameId) is written in the artwork, where
   *  its names are chosen (By selection); undefined where they are not, or the mode is off. */
  nameChosen(id: string): boolean | undefined {
    return this.s?.labels === "chosen" ? this.canvas.writtenNames().has(id) : undefined;
  }

  /** The board's menu: a name shown in the artwork, or hidden (Names: By selection). */
  showName(id: string, on: boolean): void {
    if (this.s?.labels === "chosen") this.chooseNames([id], on);
  }

  /** A frame of the board was drawn: the list of names the frame holds is read again once the board
   *  is still a moment, and at least every second while it moves. */
  frame(): void {
    if (!this.isOpen || this.s?.labels !== "chosen") return;
    clearTimeout(this.rowsWait);
    const read = () => {
      const was = this.rows, wrote = this.wrote;
      this.readRows();
      const now = this.canvas.writtenNames();
      if (was.length !== this.rows.length || was.some((r, j) => r.id !== this.rows[j].id) || wrote.size !== now.size || [...now].some((id) => !wrote.has(id))) this.renderRows();
    };
    if (performance.now() - this.rowsAt > 1000) read();
    else this.rowsWait = window.setTimeout(read, 300);
  }

  /** What the panel lists changed elsewhere (the review's targets): it is drawn again. */
  refresh(): void {
    if (this.isOpen) this.renderPanel();
  }

  /** The mode, from the Export window: the reader's last settings, the whole board in the frame; or,
   *  from a link's recipe (ExportSpec decision 20, shared/artrecipe.ts), the settings it gives — not
   *  kept as the reader's until they change one. Resolves once the mode has come: the board drawn
   *  with its look, the camera where it goes. */
  open(given?: Partial<ArtSettings>): Promise<void> {
    if (this.isOpen && !this.leaving) return Promise.resolve();
    const s = cleanSettings(given ?? this.hooks.saved(), this.hooks.now());
    // the whole board in the frame, below the title where there is one
    const came = this.start(s, (r) => {
      const own = this.hooks.titles();
      const titled = !!(s.title ?? own.title) || !!(s.subtitle ?? own.subtitle);
      const below = titled ? Math.min(r.h * 0.4, ((s.titleSize * 1.7) / 100) * r.h + Math.max(14, r.h * 0.035)) : 0;
      return this.canvas.fitCam({ x: r.x, y: r.y + below, w: r.w, h: r.h - below });
    });
    this.hooks.changed();
    return came;
  }

  /** The reader leaves: the board drawn as before, the camera where it was. Resolves once the mode
   *  has gone. */
  close(): Promise<void> {
    if (!this.isOpen || this.leaving) return Promise.resolve();
    const gone = this.end(true);
    this.hooks.changed();
    return gone;
  }

  /** The mode as presence carries it: its settings, and the rectangle of the board's world the frame
   *  holds — its middle, its width and height. */
  view(): ArtworkView | null {
    if (!this.isOpen || !this.s) return null;
    const r = this.rect, C = this.canvas;
    const [cx, cy] = C.toWorld(r.x + r.w / 2, r.y + r.h / 2);
    return { ...this.s, region: [cx, cy, r.w / C.cam.k, r.h / C.cam.k] };
  }

  /** A followed reader's artwork, or a link's: on with their settings — not kept as this reader's —
   *  the frame holding what theirs holds; off where theirs is. */
  follow(v: ArtworkView | null): void {
    if (!v) {
      void this.end(false);
      return;
    }
    const { region, ...s } = v;
    if (!this.isOpen || this.leaving) {
      void this.start(s, (r) => this.camHolding(region, r));
      return;
    }
    if (!sameLook(this.s!, s)) {
      this.s = s;
      this.hooks.look(s);
      this.place(false);
      this.renderPanel();
    }
    const cam = this.camHolding(region, this.rect);
    if (cam) this.canvas.jumpTo(cam);
  }

  /** The mode comes (ExportSpec decision 19, the owner's decision of 2026-10-15: as smoothly as the
   *  linear form, web/src/linear.ts): the frame closes in from the whole screen as its shade comes,
   *  the camera glides to where `aim` puts it in the frame, the panel slides in; the board dips to
   *  its ground a moment, takes the artwork's look and comes back; the title and the foot come last.
   *  Resolves when it has come (or a newer step took its place). */
  private start(s: ArtSettings, aim: (rect: { x: number; y: number; w: number; h: number }) => { x: number; y: number; k: number } | null): Promise<void> {
    const turn = ++this.turn;
    const body = document.body;
    this.s = s;
    if (!this.leaving || !this.before) this.before = { ...this.canvas.cam };
    this.leaving = false;
    document.addEventListener("keydown", this.onKey, true);
    body.classList.add("art-moving", "art-dip", "framing");
    if (this.root.hidden) {
      // from the whole screen, unshaded, the panel away
      this.root.hidden = false;
      this.panel.hidden = false;
      this.root.classList.add("art-away");
      this.panel.classList.add("art-away");
      // the style's ground with it
      this.rect = { x: 0, y: 0, w: innerWidth, h: innerHeight };
      this.renderSky();
      for (const el of [this.frameEl, this.sky]) Object.assign(el.style, { left: "0px", top: "0px", width: `${innerWidth}px`, height: `${innerHeight}px` });
      void this.root.offsetWidth;
    }
    this.place(false);
    requestAnimationFrame(() => {
      if (turn !== this.turn) return;
      this.root.classList.remove("art-away");
      this.panel.classList.remove("art-away");
    });
    const cam = aim(this.rect);
    if (cam) this.canvas.glideTo(cam, EASE_MS);
    this.renderPanel();
    setTimeout(() => {
      if (turn !== this.turn) return;
      this.hooks.look(s);
      body.classList.remove("art-dip");
      this.renderSky();
      this.renderInk();
    }, DIP_MS);
    return new Promise((done) =>
      setTimeout(() => {
        if (turn === this.turn) body.classList.remove("art-moving");
        done();
      }, EASE_MS),
    );
  }

  /** The mode goes, as it came: the frame opens out to the whole screen as its shade goes, the
   *  panel slides away, the camera glides back where it was (`back`); the board dips, takes its own
   *  look again, and comes back. A follower's goes with the other's, its camera theirs. Resolves when
   *  it has gone (or a newer step took its place). */
  private end(back: boolean): Promise<void> {
    if (!this.isOpen || this.leaving) return Promise.resolve();
    const turn = ++this.turn;
    const body = document.body;
    this.leaving = true;
    this.s = null;
    document.removeEventListener("keydown", this.onKey, true);
    body.classList.add("art-moving", "art-dip");
    body.classList.remove("framing");
    this.root.classList.add("art-away");
    this.panel.classList.add("art-away");
    Object.assign(this.frameEl.style, { left: "0px", top: "0px", width: `${innerWidth}px`, height: `${innerHeight}px` });
    if (back && this.before) this.canvas.glideTo(this.before, EASE_MS);
    this.before = null;
    setTimeout(() => {
      if (turn !== this.turn) return;
      this.hooks.look(null);
      this.renderSky();
      body.classList.remove("art-dip");
    }, DIP_MS);
    return new Promise((done) =>
      setTimeout(() => {
        done();
        if (turn !== this.turn) return;
        this.leaving = false;
        this.rect = { x: 0, y: 0, w: 0, h: 0 };
        this.root.hidden = true;
        this.panel.hidden = true;
        this.sky.hidden = true;
        this.root.classList.remove("art-away");
        this.panel.classList.remove("art-away");
        body.classList.remove("art-moving");
      }, EASE_MS),
    );
  }

  /** The camera that holds `region` of the board's world in the frame `r`: its middle at the frame's,
   *  its width the frame's. */
  private camHolding(region: [number, number, number, number], r: { x: number; y: number; w: number; h: number }): { x: number; y: number; k: number } {
    const k = Math.min(ZOOM_MOST, Math.max(ZOOM_LEAST, r.w / region[2]));
    const { w: sw, h: sh } = this.canvas.screen;
    return { x: region[0] - (r.x + r.w / 2 - sw / 2) / k, y: region[1] - (r.y + r.h / 2 - sh / 2) / k, k };
  }

  /** The frame in the middle of the room the panel leaves, of the size's shape. `keep`: the frame
   *  there keeps what it showed — the same middle, as much of the board. */
  private place(keep: boolean): void {
    const s = this.s!;
    // the bar above, the panel at the right; the title's strip over the frame and the source's under it
    const roomW = innerWidth - PANEL_W - 3 * MARGIN, roomH = innerHeight - 60 - HEAD_ROOM - TAIL_ROOM - 2 * GAP;
    const scale = Math.min(roomW / s.w, roomH / s.h);
    const w = Math.max(40, s.w * scale), h = Math.max(40, s.h * scale);
    const x = MARGIN + (roomW - w) / 2, y = 60 + GAP + HEAD_ROOM + (roomH - h) / 2;
    const was = this.rect;
    if (keep && was.w > 0) {
      const C = this.canvas;
      const [cx, cy] = C.toWorld(was.x + was.w / 2, was.y + was.h / 2);
      const k = C.cam.k * Math.sqrt((w * h) / (was.w * was.h));
      const { w: sw, h: sh } = C.screen;
      // the frame and the camera ease to their new shape together, the title and the foot waiting
      const turn = this.turn;
      document.body.classList.add("art-moving");
      C.glideTo({ x: cx - (x + w / 2 - sw / 2) / k, y: cy - (y + h / 2 - sh / 2) / k, k }, EASE_MS);
      setTimeout(() => turn === this.turn && !this.leaving && document.body.classList.remove("art-moving"), EASE_MS);
    }
    this.rect = { x, y, w, h };
    Object.assign(this.frameEl.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    Object.assign(this.sky.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    this.placeStrips();
    this.renderSky();
    this.renderInk();
  }

  /** The strips beside the frame, each on one line (the owner's decision of 2026-10-15): the title's
   *  above its top left, further left where it would reach the panel; the source's below its bottom
   *  right, further right where it would leave the screen. */
  private placeStrips(): void {
    const { x, y, w, h } = this.rect;
    const end = innerWidth - PANEL_W - MARGIN - 16;
    // measured where nothing narrows them
    Object.assign(this.head.style, { left: `${MARGIN}px`, top: `${y - 8}px`, maxWidth: `${end - MARGIN}px` });
    Object.assign(this.tail.style, { right: "0px", top: `${y + h + 8}px` });
    const hw = this.head.offsetWidth, tw = this.tail.offsetWidth;
    this.head.style.left = `${Math.max(MARGIN, Math.min(x, end - hw))}px`;
    this.tail.style.right = `${Math.max(0, Math.min(innerWidth - x - w, innerWidth - MARGIN - tw))}px`;
  }

  /** The style's ground under the board, within the frame (artwork.ts, drawBackdrop): none for the
   *  board's style, or where the picture is transparent. */
  private renderSky(): void {
    const s = this.s, r = this.rect;
    const on = !!s && s.style !== "board" && s.background !== "transparent" && r.w > 0;
    this.sky.hidden = !on;
    if (!on) return;
    const dpr = window.devicePixelRatio || 1;
    [this.sky.width, this.sky.height] = [Math.round(r.w * dpr), Math.round(r.h * dpr)];
    const ctx = this.sky.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackdrop(ctx, s.style, { x: 0, y: 0, w: r.w, h: r.h });
  }

  /** The title and the foot over the board, within the frame, as the files will have them. */
  private renderInk(): void {
    const s = this.s, r = this.rect;
    if (!s || !r.w) return;
    const dpr = window.devicePixelRatio || 1;
    [this.ink.width, this.ink.height] = [Math.round(r.w * dpr), Math.round(r.h * dpr)];
    const ctx = this.ink.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rect = { x: 0, y: 0, w: r.w, h: r.h };
    // outside the border, the ground alone: over the board here, as the files leave it out
    if (s.border) {
      ctx.save();
      borderBand(ctx, rect);
      ctx.clip("evenodd");
      if (s.background === "transparent") {
        // nothing: shown as the board shows it, a checkerboard
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--canvas").trim();
        ctx.fillRect(0, 0, r.w, r.h);
        ctx.fillStyle = "rgba(128, 128, 128, 0.2)";
        for (let y = 0; y < r.h; y += 8) for (let x = (y / 8) % 2 ? 8 : 0; x < r.w; x += 16) ctx.fillRect(x, y, 8, 8);
      } else if (s.style === "board") {
        ctx.fillStyle = themeBackground();
        ctx.fillRect(0, 0, r.w, r.h);
      } else drawBackdrop(ctx, s.style, rect);
      ctx.restore();
    }
    this.writeOver(ctx, s, rect);
  }

  /** What an artwork writes over the board within `rect`: its border, its title and its foot. */
  private writeOver(ctx: CanvasRenderingContext2D, s: ArtSettings, rect: { x: number; y: number; w: number; h: number }): void {
    const own = this.hooks.titles();
    const cs = getComputedStyle(document.body);
    const v = (name: string) => cs.getPropertyValue(name).trim();
    const halo = s.style === "cells" ? "#0f1520" : s.style === "stars" ? "#090d1a" : v("--canvas");
    if (s.border) drawBorder(ctx, rect, s.style === "cells" ? "rgba(200, 212, 236, 0.55)" : s.style === "stars" ? "rgba(241, 230, 200, 0.55)" : v("--text-2"));
    drawTitle(ctx, rect, s.title ?? own.title, s.subtitle ?? own.subtitle, s.titleSize, s.style, { ink: v("--text"), quiet: v("--text-2"), halo });
    const quiet = s.style === "board" ? v("--text-2") : "rgba(200, 208, 224, 0.7)";
    drawFoot(ctx, rect, s.source ? this.hooks.source() : null, { text: quiet, halo }, ART_SANS, s.footSize);
  }

  /** The title, its line or its size changed beside the frame, or the foot's size: kept, drawn over
   *  the board at once, and said to those following once it has been still a moment. */
  private titled(t: HTMLInputElement): void {
    const s = this.s;
    if (!s || this.busy) return;
    if (t.dataset.art === "titleSize") {
      s.titleSize = Math.min(TITLE_SIZE.most, Math.max(TITLE_SIZE.least, Number(t.value) || TITLE_SIZE.first));
      const out = this.head.querySelector("[data-art-size]");
      if (out) out.textContent = `${s.titleSize}%`;
    } else if (t.dataset.art === "footSize") {
      s.footSize = Math.min(FOOT_SIZE.most, Math.max(FOOT_SIZE.least, Number(t.value) || FOOT_SIZE.first));
      const out = this.tail.querySelector("[data-art-foot-size]");
      if (out) out.textContent = `${s.footSize}%`;
    } else {
      s[t.dataset.art as "title" | "subtitle"] = t.value.slice(0, 120);
      const own = this.head.querySelector<HTMLElement>("[data-art-own]");
      if (own) own.hidden = false;
    }
    this.hooks.save(s);
    this.renderInk();
    clearTimeout(this.titleWait);
    this.titleWait = window.setTimeout(() => this.hooks.changed(), 400);
  }

  private measure = (text: string, font: string): number => {
    this.measureCtx ??= document.createElement("canvas").getContext("2d");
    const c = this.measureCtx;
    if (!c) return text.length * 6;
    c.font = font;
    return c.measureText(text).width;
  };

  /** A setting changed in the panel: kept as the reader's, drawn on the board at once. */
  private changed(t: HTMLInputElement): void {
    const s = this.s;
    // the filter over the names is the reader's own (the panel's `input`); the title is taken as it is
    // typed (titled)
    if (t.dataset.artFilter !== undefined || t.dataset.art === "title" || t.dataset.art === "subtitle" || t.dataset.art === "titleSize" || t.dataset.art === "footSize") return;
    if (t.dataset.artName !== undefined) return this.chooseNames([t.dataset.artName], t.checked);
    if (t.dataset.artTarget !== undefined) return this.choose("targets", [t.dataset.artTarget], t.checked);
    const k = t.dataset.art;
    // a file being made is made with the settings it began with
    if (!s || !k || this.busy) return this.renderPanel();
    const sized = k === "preset" || k === "orient" || k === "w" || k === "h";
    if (k === "preset") {
      // a preset in the orientation chosen
      const p = PRESETS[Number(t.value)];
      if (p) ({ w: s.w, h: s.h } = oriented(p.w, p.h, s.h > s.w));
    } else if (k === "orient") ({ w: s.w, h: s.h } = oriented(s.w, s.h, t.value === "portrait"));
    // the cells and the starfield are dark: drawn on their own ground, or on none
    else if (k === "style") {
      s.style = t.value === "cells" || t.value === "stars" ? t.value : "board";
      if (s.style !== "board") s.theme = "dark";
    }
    else if (k === "w" || k === "h") s[k] = Math.max(16, Math.min(MAX_SIDE, Math.round(Number(t.value)) || s[k]));
    else if (k === "look") {
      // the theme, on its background or on none
      const [theme, clear] = t.value.split("-");
      s.theme = theme === "dark" ? "dark" : "light";
      s.background = clear ? "transparent" : "theme";
    } else if (k === "notes" || k === "selection" || k === "source" || k === "keys" || k === "border") s[k] = t.checked;
    else {
      (s as unknown as Record<string, string>)[k] = t.value;
      // by selection, from what was drawn: As shown, nothing hidden or added; every target
      if (k === "labels" && t.value === "chosen") {
        [s.namesFrom, s.hiddenNames, s.shownNames, s.ruledNames] = ["board", [], [], []];
        this.filter = "";
      } else if (k === "targets" && t.value === "chosen") {
        const r = withChosen([], this.hooks.targets().map((x) => x.name), ART_TARGETS_BYTES);
        s.shownTargets = r.list;
        if (r.left) this.hooks.say(NO_ROOM(r.left, "target"));
      }
    }
    this.hooks.save(s);
    this.hooks.look(s);
    if (sized) this.place(true);
    this.renderPanel();
    this.hooks.changed();
  }

  /** Targets chosen, or no longer (By selection): from their list, its All and None. What does not
   *  fit in what the artwork carries to those following is left out, and said. */
  private choose(which: "targets", ids: readonly string[], on: boolean): void {
    const s = this.s;
    if (!s || this.busy) return this.renderPanel();
    if (on) {
      const r = withChosen(s.shownTargets, ids, ART_TARGETS_BYTES);
      s.shownTargets = r.list;
      if (r.left) this.hooks.say(NO_ROOM(r.left, which.slice(0, -1)));
    } else {
      const off = new Set(ids);
      s.shownTargets = s.shownTargets.filter((x) => !off.has(x));
    }
    this.settled();
  }

  /** Names shown, or hidden (By selection): from their list, its All and None, or the board's menu.
   *  A name ticked is no longer hidden, and is shown besides where the board does not write it now; a
   *  name unticked is no longer shown besides, and is hidden where the board would write it all the
   *  same. What does not fit in what the artwork carries is left out, and said. A name a recipe's
   *  rule chose (ExportSpec decision 20) is the reader's once ticked — written wherever it falls, as
   *  one ticked by hand — and no longer the rule's once unticked, hidden where the board would write
   *  it (artwork chooseIn). */
  private chooseNames(ids: readonly string[], on: boolean): void {
    const s = this.s;
    if (!s || this.busy) return this.renderPanel();
    const now = this.canvas.writtenNames();
    const { hidden, shown, ruled, add, hide } = chooseIn(s, now, ids, on);
    s.ruledNames = ruled;
    const a = withChosen(shown, add, ART_NAMES_BYTES), h = withChosen(hidden, hide, ART_NAMES_BYTES);
    [s.shownNames, s.hiddenNames] = [a.list, h.list];
    if (a.left + h.left) this.hooks.say(NO_ROOM(a.left + h.left, "name"));
    // ticked as chosen until the board has drawn it
    const wrote = new Set(now);
    for (const id of ids) {
      if (on) wrote.add(id);
      else wrote.delete(id);
    }
    this.wrote = wrote;
    this.settled(true);
  }

  /** A choice made: kept as the reader's, drawn, said to those following. */
  private settled(held = false): void {
    const s = this.s!;
    this.hooks.save(s);
    this.hooks.look(s);
    this.renderPanel(held);
    this.hooks.changed();
  }

  /** All or None, of the targets; of the names, those the filter holds in the frame. With no filter,
   *  the names start again: As shown, or none at all. */
  private pick(what: string): void {
    const [which, all] = what.split("-");
    const s = this.s;
    if (!s) return;
    if (which === "targets") return this.choose("targets", this.hooks.targets().map((t) => t.name), all === "all");
    // the title and its line as the project has them
    if (which === "title") {
      [s.title, s.subtitle] = [null, null];
      return this.settled();
    }
    if (!this.filter.trim()) {
      if (this.busy) return this.renderPanel();
      [s.namesFrom, s.hiddenNames, s.shownNames, s.ruledNames] = [all === "all" ? "board" : "none", [], [], []];
      return this.settled();
    }
    this.chooseNames(nameRows(this.rows, this.filter, Infinity).rows.map((r) => r.id), all === "all");
  }

  /** The names the frame holds, and those the board writes; `held`, what is ticked kept as it was
   *  just made (a choice the board has not drawn yet). */
  private readRows(held = false): void {
    this.rows = this.canvas.artNames(this.rect);
    if (!held) this.wrote = new Set(this.canvas.writtenNames());
    this.rowsAt = performance.now();
  }

  /** The list of names, under the filter, and what is chosen of them; drawn again without the rest of
   *  the panel, its scroll kept. */
  private renderRows(): void {
    const s = this.s;
    const el = this.panel.querySelector<HTMLElement>(`[data-art-rows="names"]`);
    if (!s || !el) return;
    const top = el.scrollTop;
    el.innerHTML = this.rowsHtml();
    el.scrollTop = top;
    const f = !!this.filter.trim();
    this.panel.querySelector(`[data-art-pick="names-all"]`)!.textContent = f ? "All these" : "As shown";
    this.panel.querySelector(`[data-art-pick="names-none"]`)!.textContent = f ? "None of these" : "None";
    this.panel.querySelector(`[data-art-count="names"]`)!.textContent = this.namesCount();
  }

  private rowsHtml(): string {
    const on = this.wrote;
    const { rows, more } = nameRows(this.rows, this.filter);
    const row = (r: NameRow) =>
      `<label class="art-row" title="${escapeHtml(r.full)}"><input type="checkbox" data-art-name="${escapeHtml(r.id)}"${on.has(r.id) ? " checked" : ""}><span>${escapeHtml(r.label)}</span></label>`;
    const cl = rows.filter((r) => r.cluster), ds = rows.filter((r) => !r.cluster);
    return (
      (cl.length ? `<div class="art-rows-h">Clusters</div>${cl.map(row).join("")}` : "") +
      (ds.length ? `<div class="art-rows-h">Declarations</div>${ds.map(row).join("")}` : "") +
      (!rows.length ? `<div class="art-rows-h">${this.filter.trim() ? "No name in the frame holds this" : "No name in the frame"}</div>` : "") +
      (more ? `<div class="art-rows-h">${more.toLocaleString("en")} more: narrow the filter</div>` : "")
    );
  }

  private namesCount(): string {
    const s = this.s;
    const here = this.rows.filter((r) => this.wrote.has(r.id)).length;
    const n = (k: number, what: string) => (k ? ` · ${k.toLocaleString("en")} ${what}` : "");
    return `${here.toLocaleString("en")} of ${this.rows.length.toLocaleString("en")} in the frame written${s?.namesFrom === "none" ? " · from none" : ""}${n(s?.hiddenNames.length ?? 0, "hidden")}${n(s?.shownNames.length ?? 0, "shown besides")}${n(s?.ruledNames.length ?? 0, "by a rule")}`;
  }

  private renderPanel(held = false): void {
    const s = this.s;
    if (!s) return;
    this.renderSky();
    this.renderInk();
    // what the reader was at in the panel, kept: the lists' scroll, the control with the focus
    const scrolls = [...this.panel.querySelectorAll<HTMLElement>("[data-art-rows]")].map((el) => [el.dataset.artRows!, el.scrollTop] as const);
    const was = document.activeElement instanceof HTMLElement && this.panel.contains(document.activeElement) ? document.activeElement : null;
    const mark = was && ["art", "artName", "artTarget", "artPick", "artFilter"].find((k) => was.dataset[k] !== undefined);
    const caret = was instanceof HTMLInputElement && mark === "artFilter" ? [was.selectionStart, was.selectionEnd] : null;
    if (s.labels === "chosen") this.readRows(held);
    const opt = (v: string, label: string, cur: string) => `<option value="${v}"${v === cur ? " selected" : ""}>${label}</option>`;
    const sel = (k: keyof ArtSettings, label: string, opts: [string, string][]) =>
      `<label class="ex-field"><span>${label}</span><select data-art="${k}">${opts.map(([v, l]) => opt(v, l, String(s[k]))).join("")}</select></label>`;
    const wide = (html: string) => html.replace(`<label class="ex-field">`, `<label class="ex-field ex-wide">`);
    const check = (k: "notes" | "selection" | "source" | "keys" | "border", label: string, title = "", off = false) =>
      `<label class="ex-check${off ? " muted" : ""}"${title ? ` title="${escapeHtml(title)}"` : ""}><input type="checkbox" data-art="${k}"${s[k] && !off ? " checked" : ""}${off ? " disabled" : ""}> ${label}</label>`;
    const preset = presetOf(s.w, s.h);
    const mp = ((s.w * s.h) / 1e6).toFixed(1);
    const look = `${s.theme}${s.background === "transparent" ? "-clear" : ""}`;
    const source = this.hooks.source();
    const section = (title: string, body: string) => `<section class="art-sec"><h3 class="art-sec-h">${title}</h3><div class="art-grid">${body}</div></section>`;
    this.panel.innerHTML =
      `<div class="ex-head"><div class="modal-title">Artwork</div><button class="icon" data-art-done title="Done (Esc)">✕</button></div>` +
      `<div class="modal-text">The board is the picture: pan, zoom, select and drag as ever. What the frame holds is saved; its title and its foot are set beside it.</div>` +
      `<div class="art-secs">` +
      section(
        "Picture",
        `<label class="ex-field"><span>Size</span><select data-art="preset"><option value="-1"${preset < 0 ? " selected" : ""}>Custom</option>${PRESETS.map((p, i) => `<option value="${i}"${i === preset ? " selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}</select></label>` +
          `<label class="ex-field"><span>Orientation</span><select data-art="orient"${s.w === s.h ? " disabled" : ""}>${opt("landscape", "Landscape", s.h > s.w ? "" : "landscape")}${opt("portrait", "Portrait", s.h > s.w ? "portrait" : "")}</select></label>` +
          `<label class="ex-field"><span>Width</span><input type="number" min="16" max="${MAX_SIDE}" step="1" data-art="w" value="${s.w}"></label>` +
          `<label class="ex-field"><span>Height</span><input type="number" min="16" max="${MAX_SIDE}" step="1" data-art="h" value="${s.h}"></label>` +
          `<div class="art-note muted">${mp} megapixels · names ${Math.round((11 * s.w) / Math.max(this.rect.w, 1))} px high</div>` +
          `<div class="ex-checks">${check("border", "A thin border round the picture")}</div>`,
      ) +
      section(
        "Look",
        sel("style", "Style", [["board", "As the board"], ["cells", "Cells"], ["stars", "Starfield"]]) +
          `<label class="ex-field"><span>Theme</span><select data-art="look">${(s.style === "board"
            ? [
                ["light", "Light"],
                ["dark", "Dark"],
                ["light-clear", "Transparent, for a light page"],
                ["dark-clear", "Transparent, for a dark page"],
              ]
            : [
                ["dark", s.style === "stars" ? "Night sky" : "Dark field"],
                ["dark-clear", "Transparent, for a dark page"],
              ]
          )
            .map(([v, l]) => opt(v, l, look))
            .join("")}</select></label>` +
          sel("scheme", "Colouring", [["kind", "Kind"], ["status", "Status"]]),
      ) +
      section("Names", wide(sel("labels", "Names", [["board", "As shown"], ["clusters", "Clusters only"], ["none", "None"], ["chosen", "By selection"]])) + (s.labels === "chosen" ? this.namesHtml() : "")) +
      section(
        "Targets and keys",
        wide(sel("targets", "Targets", [["marked", "Star and name"], ["plain", "As any"], ["highlight", "Alone, the rest faded"], ["chosen", "By selection"]])) +
          (s.targets === "chosen" ? this.targetsHtml() : "") +
          `<div class="ex-checks">${check("keys", "Key marks", "The key declarations' diamonds; with the targets by selection, those of the targets ticked")}</div>`,
      ) +
      section("Edges and the rest", wide(sel("edges", "Edges", [["all", "All"], ["selection", "The selection's"], ["none", "None"]])) + `<div class="ex-checks">${check("notes", "Notes")}${check("selection", "The selection, as you see it")}</div>`) +
      `</div>` +
      `<div class="modal-actions art-save"><button class="rv-btn" data-art-done>Done</button><button class="rv-btn" data-art-save="svg"${this.busy ? " disabled" : ""}>Save SVG</button><button class="rv-btn primary" data-art-save="png"${this.busy ? " disabled" : ""}>${this.busy ? "Saving…" : "Save PNG"}</button></div>`;
    // beside the frame, in its shade: the title above its top left, the source below its bottom right
    this.head.innerHTML = this.titleHtml();
    // and the foot's size, both its lines
    // — up to as large as the picture holds on one line, its shape and the source's line as they are
    const most = Math.min(FOOT_SIZE.most, Math.max(FOOT_SIZE.least, Math.floor(footMost(this.measure, s.w, s.h, s.source ? source : null, ART_SANS) * 10) / 10));
    const foot = Math.min(s.footSize, most);
    this.tail.innerHTML =
      check("source", "Source and commit", source ?? "This project is not a git repository", !source) +
      `<label class="ex-field art-size"><span>Size <output data-art-foot-size>${foot}%</output></span><input type="range" data-art="footSize" min="${FOOT_SIZE.least}" max="${most}" step="0.1" value="${foot}" aria-label="The foot's size, in hundredths of the picture's height"></label>`;
    if (this.rect.w) this.placeStrips();
    for (const [k, top] of scrolls) {
      const el = this.panel.querySelector<HTMLElement>(`[data-art-rows="${k}"]`);
      if (el) el.scrollTop = top;
    }
    if (was && mark) {
      const key = mark.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      const now = [...this.panel.querySelectorAll<HTMLElement>(`[data-${key}]`)].find((el) => el.dataset[mark] === was.dataset[mark]);
      now?.focus({ preventScroll: true });
      if (now instanceof HTMLInputElement && caret) now.setSelectionRange(caret[0], caret[1]);
    }
  }

  /** The title, its line and its size, above the frame's top left; the project's own again. */
  private titleHtml(): string {
    const s = this.s!;
    const own = this.hooks.titles();
    const field = (k: "title" | "subtitle", label: string, wide: string) =>
      `<label class="ex-field art-head-field" style="--w:${wide}"><span>${label}</span><input type="text" data-art="${k}" maxlength="120" spellcheck="false" value="${escapeHtml(s[k] ?? own[k])}" placeholder="None"></label>`;
    return (
      field("title", "Title", "11em") +
      field("subtitle", "Under it", "15em") +
      `<label class="ex-field art-head-field art-size"><span>Size <output data-art-size>${s.titleSize}%</output></span><input type="range" data-art="titleSize" min="${TITLE_SIZE.least}" max="${TITLE_SIZE.most}" step="0.5" value="${s.titleSize}" aria-label="The title's size, in hundredths of the picture's height"></label>` +
      `<button class="rv-btn" data-art-pick="title-own" title="The project's name, and what it holds"${s.title !== null || s.subtitle !== null ? "" : " hidden"} data-art-own>The project's own</button>`
    );
  }

  /** Names by selection: the filter, All and None, the names the frame holds ticked or not. */
  private namesHtml(): string {
    const f = !!this.filter.trim();
    return (
      `<div class="art-pick">` +
      `<div class="art-pick-head"><input type="search" class="art-filter" data-art-filter placeholder="Filter the names in the frame" aria-label="Filter the names in the frame" spellcheck="false" value="${escapeHtml(this.filter)}">` +
      `<button class="rv-btn" data-art-pick="names-all" title="With a filter, tick every name it holds; without one, start again from As shown">${f ? "All these" : "As shown"}</button>` +
      `<button class="rv-btn" data-art-pick="names-none" title="With a filter, untick every name it holds; without one, start again from no name">${f ? "None of these" : "None"}</button></div>` +
      `<div class="art-rows" data-art-rows="names">${this.rowsHtml()}</div>` +
      `<div class="art-note muted" data-art-count="names">${this.namesCount()}</div>` +
      `</div>`
    );
  }

  /** Targets by selection: every target of the review, ticked to be marked. */
  private targetsHtml(): string {
    const s = this.s!;
    const all = this.hooks.targets();
    const on = new Set(s.shownTargets);
    const rows = all
      .map((t) => `<label class="art-row" title="${escapeHtml(t.name)}"><input type="checkbox" data-art-target="${escapeHtml(t.name)}"${on.has(t.name) ? " checked" : ""}><span>${escapeHtml(t.label)}</span></label>`)
      .join("");
    const n = all.filter((t) => on.has(t.name)).length;
    return (
      `<div class="art-pick">` +
      `<div class="art-pick-head"><span class="muted">Their star and name, each ticked</span><button class="rv-btn" data-art-pick="targets-all">All</button><button class="rv-btn" data-art-pick="targets-none">None</button></div>` +
      `<div class="art-rows" data-art-rows="targets">${rows || `<div class="art-rows-h">The review has no target</div>`}</div>` +
      `<div class="art-note muted">${n} of ${all.length} marked</div>` +
      `</div>`
    );
  }

  /** The files a link's recipe asks for (ExportSpec decision 20), one after the other, as Save SVG
   *  and Save PNG make them; those made. */
  async save(kinds: readonly ("png" | "svg")[]): Promise<("png" | "svg")[]> {
    const made: ("png" | "svg")[] = [];
    if (!this.isOpen || !this.s) return made;
    for (const k of kinds) if (await this.saveFile(k)) made.push(k);
    return made;
  }

  /** Make the file, at the full size, from the board as it is drawn now, and hand it to the browser
   *  to save; whether it was made. */
  private async saveFile(kind: "png" | "svg"): Promise<boolean> {
    if (this.busy || !this.s) return false;
    const s = { ...this.s };
    const C = this.canvas;
    const rect = { ...this.rect }, cam = { ...C.cam };
    // the ground: the theme's, the style's own (drawBackdrop), or none
    const ground = s.background !== "transparent";
    const bg = ground && s.style === "board" ? themeBackground() : null;
    const notes = s.notes ? this.hooks.notes() : [];
    const name = artName(this.hooks.title(), kind);
    // the fonts written in, there before anything is drawn with them
    await Promise.all(ART_FACES.map((f) => document.fonts?.load(f).catch(() => []))).catch(() => {});
    if (kind === "svg") {
      const svg = artSvg(rect, s, bg, ART_SANS, this.measure, (pen) => {
        const ctx = pen as unknown as CanvasRenderingContext2D;
        if (ground) drawBackdrop(ctx, s.style, rect);
        // within the border, where there is one: outside it, the ground alone
        if (s.border) {
          const i = borderInset(rect);
          pen.clipRect("inside", rect.x + i, rect.y + i, rect.w - 2 * i, rect.h - 2 * i);
          pen.raw(`<g clip-path="url(#inside)">`);
        }
        for (const sh of C.artShapes(rect)) pen.shape(sh);
        C.drawMarks(ctx);
        // a note's glyph is SVG already
        drawNotes(ctx, notes, ART_SANS, (n) => pen.raw(`<g transform="translate(${n.x - n.glyphPx / 2} ${n.y - n.glyphPx / 2}) scale(${n.glyphPx / 16})" color="${n.colour}">${n.glyph}</g>`));
        if (s.border) pen.raw(`</g>`);
        this.writeOver(ctx, s, rect);
      }, await faces());
      download(new Blob([svg], { type: "image/svg+xml" }), name);
      return true;
    }
    this.busy = true;
    this.renderPanel();
    try {
      // the notes' glyphs as pictures, decoded before the bands are drawn
      const glyphs = new Map<string, HTMLImageElement>();
      for (const n of notes) {
        const key = n.colour + n.glyph;
        if (glyphs.has(key)) continue;
        const img = new Image();
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(glyphSvg(n.glyph, n.colour, 64))}`;
        await img.decode().catch(() => {});
        glyphs.set(key, img);
      }
      // the frame's pixels to the picture's
      const f = s.w / rect.w;
      // drawn a band of rows at a time, as large a band as the browser draws at once
      const band = Math.max(1, Math.min(s.h, 2048, Math.floor(BAND_PIXELS / s.w)));
      const cv = document.createElement("canvas");
      cv.width = s.w;
      cv.height = band;
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("no canvas");
      const write = (c: CanvasRenderingContext2D) => this.writeOver(c, s, rect);
      async function* bands(): AsyncGenerator<Uint8ClampedArray> {
        for (let y = 0; y < s.h; y += band) {
          const n = Math.min(band, s.h - y);
          ctx!.setTransform(1, 0, 0, 1, 0, 0);
          ctx!.clearRect(0, 0, s.w, band);
          if (bg) {
            ctx!.fillStyle = bg;
            ctx!.fillRect(0, 0, s.w, n);
          } else if (ground) {
            ctx!.setTransform(f, 0, 0, f, -rect.x * f, -(rect.y * f + y));
            drawBackdrop(ctx!, s.style, rect);
            ctx!.setTransform(1, 0, 0, 1, 0, 0);
          }
          C.paintArtBand(ctx!, rect, f, y, n, cam);
          ctx!.setTransform(f, 0, 0, f, -rect.x * f, -(rect.y * f + y));
          drawNotes(ctx!, notes, ART_SANS, (n) => {
            const img = glyphs.get(n.colour + n.glyph);
            if (img?.complete && img.naturalWidth) ctx!.drawImage(img, n.x - n.glyphPx / 2, n.y - n.glyphPx / 2, n.glyphPx, n.glyphPx);
          });
          // outside the border, the ground alone (the owner's decision of 2026-10-15)
          if (s.border) {
            ctx!.save();
            borderBand(ctx!, rect);
            if (bg) {
              ctx!.fillStyle = bg;
              ctx!.fill("evenodd");
            } else if (ground) {
              ctx!.clip("evenodd");
              drawBackdrop(ctx!, s.style, rect);
            } else {
              ctx!.globalCompositeOperation = "destination-out";
              ctx!.fill("evenodd");
            }
            ctx!.restore();
          }
          write(ctx!);
          yield ctx!.getImageData(0, 0, s.w, n).data;
        }
      }
      download(await encodePng(s.w, s.h, bands()), name);
      return true;
    } catch {
      this.hooks.say(`This browser could not draw a picture of ${s.w} × ${s.h} pixels: choose a smaller size, or save the SVG.`);
      return false;
    } finally {
      this.busy = false;
      this.renderPanel();
    }
  }
}

/** the faces an artwork writes in: drawn with them once they are there */
const ART_FACES = [`400 16px ${ART_DISPLAY}`, `500 16px ${ART_DISPLAY}`, `400 16px ${ART_SANS}`, `italic 400 16px ${ART_SANS}`, `600 16px ${ART_SANS}`, `700 16px ${ART_SANS}`, `400 16px ${ART_SERIF}`, `italic 400 16px ${ART_SERIF}`, `500 16px ${ART_SERIF}`, `600 16px ${ART_SERIF}`];

/** The artwork's fonts as an SVG carries them, so that it is written in them wherever it is opened:
 *  each face the page declares for them (web/style.css), its file within. A face that cannot be
 *  read is left to the name of its family. */
async function faces(): Promise<string> {
  const out: string[] = [];
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of [...rules]) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const st = rule.style;
      const family = st.getPropertyValue("font-family").replace(/["']/g, "").trim();
      if (family !== "Source Sans 3" && family !== "Source Serif 4" && family !== "Jost") continue;
      const url = /url\(["']?([^"')]+)["']?\)/.exec(st.getPropertyValue("src"))?.[1];
      if (!url) continue;
      try {
        const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        out.push(`@font-face{font-family:"${family}";font-style:${st.getPropertyValue("font-style") || "normal"};font-weight:${st.getPropertyValue("font-weight") || "400"};src:url(data:font/woff2;base64,${btoa(bin)}) format("woff2");unicode-range:${st.getPropertyValue("unicode-range") || "U+0-10FFFF"}}`);
      } catch {
        // its family's name alone
      }
    }
  }
  return out.join("");
}

/** Hand a file to the browser to save. */
function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
