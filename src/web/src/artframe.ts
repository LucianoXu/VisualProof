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

import type { ArtworkView } from "../../shared/collab.ts";
import { ZOOM_LEAST, ZOOM_MOST } from "../../shared/sticky.ts";
import type { ArtSettings, NotePicture } from "./artwork.ts";
import { artName, artSvg, cleanSettings, drawFoot, drawNotes, encodePng, glyphSvg, MAX_SIDE, oriented, PRESETS, presetOf, themeBackground } from "./artwork.ts";
import type { GraphCanvas } from "./canvas.ts";
import { FONT } from "./canvas.ts";
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
  say(text: string): void;
}

/** the panel's width, and the room kept around the frame */
const PANEL_W = 300;
const MARGIN = 32;
/** the most pixels a band of a PNG is drawn in at once: what every browser's canvas allows */
const BAND_PIXELS = 4096 * 4096;

const sameLook = (a: ArtSettings, b: ArtSettings) => (Object.keys(a) as (keyof ArtSettings)[]).every((k) => a[k] === b[k]);

export class ArtFrame {
  private root: HTMLElement;
  private frameEl: HTMLElement;
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
  /** Esc leaves, unless it is a field's, a menu's or a dialog's */
  private onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    if (t && !this.panel.contains(t) && t.closest?.("input, textarea, [contenteditable], [role=menu], [role=dialog], #modal")) return;
    if (document.querySelector("#ctxmenu:not([hidden])")) return;
    e.preventDefault();
    e.stopPropagation();
    this.close();
  };

  constructor(root: HTMLElement, panel: HTMLElement, canvas: GraphCanvas, hooks: ArtHooks) {
    this.root = root;
    this.panel = panel;
    this.canvas = canvas;
    this.hooks = hooks;
    root.innerHTML = `<div class="art-frame"><div class="art-foot"></div></div>`;
    this.frameEl = root.querySelector(".art-frame")!;
    panel.addEventListener("change", (e) => this.changed(e.target as HTMLInputElement));
    panel.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-art-done]")) this.close();
      else if (t.closest("[data-art-save]")) void this.saveFile(t.closest<HTMLElement>("[data-art-save]")!.dataset.artSave as "png" | "svg");
    });
    window.addEventListener("resize", () => this.isOpen && this.place(true));
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** The settings the board is drawn with: null where the mode is off. */
  get settings(): ArtSettings | null {
    return this.s;
  }

  /** The mode, from the Export window: the reader's last settings, the whole board in the frame. */
  open(): void {
    if (this.isOpen) return;
    this.start(cleanSettings(this.hooks.saved(), this.hooks.now()));
    this.canvas.fitRect(this.rect);
    this.hooks.changed();
  }

  /** The reader leaves: the board drawn as before, the camera where it was. */
  close(): void {
    if (!this.isOpen) return;
    this.end(true);
    this.hooks.changed();
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
    if (!v) return this.end(false);
    const { region, ...s } = v;
    if (!this.isOpen) this.start(s);
    else if (!sameLook(this.s!, s)) {
      this.s = s;
      this.hooks.look(s);
      this.place(false);
      this.renderPanel();
    }
    this.hold(region);
  }

  private start(s: ArtSettings): void {
    this.s = s;
    this.root.hidden = false;
    this.panel.hidden = false;
    document.addEventListener("keydown", this.onKey, true);
    this.before = { ...this.canvas.cam };
    this.hooks.look(s);
    this.place(false);
    this.renderPanel();
  }

  private end(back: boolean): void {
    if (!this.isOpen) return;
    this.rect = { x: 0, y: 0, w: 0, h: 0 };
    this.root.hidden = true;
    this.panel.hidden = true;
    document.removeEventListener("keydown", this.onKey, true);
    this.s = null;
    this.hooks.look(null);
    if (back && this.before) this.canvas.jumpTo(this.before);
    this.before = null;
  }

  /** The frame holding `region` of the board's world: its middle at the frame's, its width the
   *  frame's. */
  private hold(region: [number, number, number, number]): void {
    const r = this.rect, C = this.canvas;
    const k = Math.min(ZOOM_MOST, Math.max(ZOOM_LEAST, r.w / region[2]));
    const { w: sw, h: sh } = C.screen;
    C.jumpTo({ x: region[0] - (r.x + r.w / 2 - sw / 2) / k, y: region[1] - (r.y + r.h / 2 - sh / 2) / k, k });
  }

  /** The frame in the middle of the room the panel leaves, of the size's shape. `keep`: the frame
   *  there keeps what it showed — the same middle, as much of the board. */
  private place(keep: boolean): void {
    const s = this.s!;
    const roomW = innerWidth - PANEL_W - 3 * MARGIN, roomH = innerHeight - 2 * MARGIN - 60;
    const scale = Math.min(roomW / s.w, roomH / s.h);
    const w = Math.max(40, s.w * scale), h = Math.max(40, s.h * scale);
    const x = MARGIN + (roomW - w) / 2, y = 60 + MARGIN + (roomH - h) / 2;
    const was = this.rect;
    if (keep && was.w > 0) {
      const C = this.canvas;
      const [cx, cy] = C.toWorld(was.x + was.w / 2, was.y + was.h / 2);
      const k = C.cam.k * Math.sqrt((w * h) / (was.w * was.h));
      const { w: sw, h: sh } = C.screen;
      C.jumpTo({ x: cx - (x + w / 2 - sw / 2) / k, y: cy - (y + h / 2 - sh / 2) / k, k });
    }
    this.rect = { x, y, w, h };
    Object.assign(this.frameEl.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
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
    const k = t.dataset.art;
    // a file being made is made with the settings it began with
    if (!s || !k || this.busy) return this.renderPanel();
    const sized = k === "preset" || k === "orient" || k === "w" || k === "h";
    if (k === "preset") {
      // a preset in the orientation chosen
      const p = PRESETS[Number(t.value)];
      if (p) ({ w: s.w, h: s.h } = oriented(p.w, p.h, s.h > s.w));
    } else if (k === "orient") ({ w: s.w, h: s.h } = oriented(s.w, s.h, t.value === "portrait"));
    else if (k === "w" || k === "h") s[k] = Math.max(16, Math.min(MAX_SIDE, Math.round(Number(t.value)) || s[k]));
    else if (k === "look") {
      // the theme, on its background or on none
      const [theme, clear] = t.value.split("-");
      s.theme = theme === "dark" ? "dark" : "light";
      s.background = clear ? "transparent" : "theme";
    } else if (k === "proofs" || k === "notes" || k === "selection" || k === "source") s[k] = t.checked;
    else (s as unknown as Record<string, string>)[k] = t.value;
    this.hooks.save(s);
    this.hooks.look(s);
    if (sized) this.place(true);
    this.renderPanel();
    this.hooks.changed();
  }

  /** The foot in the frame, as the files will have it: "Generated by VisualProof" at the bottom
   *  left, and where asked the source and commit at the bottom right (artwork.ts, drawFoot). */
  private renderFoot(): void {
    const s = this.s;
    const el = this.frameEl.querySelector<HTMLElement>(".art-foot")!;
    const source = s?.source ? this.hooks.source() : null;
    el.innerHTML = `<span>Generated by <b class="logo">VisualProof</b></span>${source ? `<span>${escapeHtml(source)}</span>` : ""}`;
  }

  private renderPanel(): void {
    const s = this.s;
    if (!s) return;
    this.renderFoot();
    const opt = (v: string, label: string, cur: string) => `<option value="${v}"${v === cur ? " selected" : ""}>${label}</option>`;
    const sel = (k: keyof ArtSettings, label: string, opts: [string, string][]) =>
      `<label class="ex-field"><span>${label}</span><select data-art="${k}">${opts.map(([v, l]) => opt(v, l, String(s[k]))).join("")}</select></label>`;
    const check = (k: "proofs" | "notes" | "selection" | "source", label: string, title = "", off = false) =>
      `<label class="ex-check${off ? " muted" : ""}"${title ? ` title="${escapeHtml(title)}"` : ""}><input type="checkbox" data-art="${k}"${s[k] && !off ? " checked" : ""}${off ? " disabled" : ""}> ${label}</label>`;
    const preset = presetOf(s.w, s.h);
    const mp = ((s.w * s.h) / 1e6).toFixed(1);
    const look = `${s.theme}${s.background === "transparent" ? "-clear" : ""}`;
    const source = this.hooks.source();
    this.panel.innerHTML =
      `<div class="ex-head"><div class="modal-title">Artwork</div><button class="icon" data-art-done title="Done (Esc)">✕</button></div>` +
      `<div class="modal-text">The board is the picture: pan, zoom, select and drag as ever. What the frame holds is saved.</div>` +
      `<div class="art-grid">` +
      `<label class="ex-field"><span>Size</span><select data-art="preset"><option value="-1"${preset < 0 ? " selected" : ""}>Custom</option>${PRESETS.map((p, i) => `<option value="${i}"${i === preset ? " selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}</select></label>` +
      `<label class="ex-field"><span>Orientation</span><select data-art="orient"${s.w === s.h ? " disabled" : ""}>${opt("landscape", "Landscape", s.h > s.w ? "" : "landscape")}${opt("portrait", "Portrait", s.h > s.w ? "portrait" : "")}</select></label>` +
      `<label class="ex-field"><span>Width</span><input type="number" min="16" max="${MAX_SIDE}" step="1" data-art="w" value="${s.w}"></label>` +
      `<label class="ex-field"><span>Height</span><input type="number" min="16" max="${MAX_SIDE}" step="1" data-art="h" value="${s.h}"></label>` +
      `<div class="art-note muted">${mp} megapixels · names ${Math.round((11 * s.w) / Math.max(this.rect.w, 1))} px high</div>` +
      `<label class="ex-field ex-wide"><span>Theme</span><select data-art="look">${[
        ["light", "Light"],
        ["dark", "Dark"],
        ["light-clear", "Transparent, for a light page"],
        ["dark-clear", "Transparent, for a dark page"],
      ]
        .map(([v, l]) => opt(v, l, look))
        .join("")}</select></label>` +
      sel("scheme", "Colouring", [["kind", "Kind"], ["status", "Status"]]) +
      sel("labels", "Names", [["board", "As shown"], ["clusters", "Clusters only"], ["none", "None"]]) +
      sel("edges", "Edges", [["all", "All"], ["selection", "The selection's"], ["none", "None"]]) +
      sel("targets", "Targets", [["marked", "Star and name"], ["plain", "As any"], ["highlight", "Alone, the rest faded"]]) +
      `<div class="ex-checks">${check("proofs", "Proof edges")}${check("notes", "Notes")}${check("selection", "The selection, as you see it")}` +
      check("source", "Source and commit, at the bottom right", source ?? "This project is not a git repository", !source) +
      `</div>` +
      `</div>` +
      `<div class="modal-actions"><button class="rv-btn" data-art-done>Done</button><button class="rv-btn" data-art-save="svg"${this.busy ? " disabled" : ""}>Save SVG</button><button class="rv-btn primary" data-art-save="png"${this.busy ? " disabled" : ""}>${this.busy ? "Saving…" : "Save PNG"}</button></div>`;
  }

  /** Make the file, at the full size, from the board as it is drawn now, and hand it to the browser
   *  to save. */
  private async saveFile(kind: "png" | "svg"): Promise<void> {
    if (this.busy || !this.s) return;
    const s = { ...this.s };
    const C = this.canvas;
    const rect = { ...this.rect }, cam = { ...C.cam };
    const bg = s.background === "transparent" ? null : themeBackground();
    const notes = s.notes ? this.hooks.notes() : [];
    const source = s.source ? this.hooks.source() : null;
    const cs = getComputedStyle(document.body);
    const foot = { text: cs.getPropertyValue("--text-2").trim(), halo: cs.getPropertyValue("--canvas").trim() };
    const name = artName(this.hooks.title(), kind);
    if (kind === "svg") {
      const svg = artSvg(rect, s, bg, FONT, this.measure, (pen) => {
        for (const sh of C.artShapes(rect)) pen.shape(sh);
        const ctx = pen as unknown as CanvasRenderingContext2D;
        C.drawMarks(ctx);
        // a note's glyph is SVG already
        drawNotes(ctx, notes, FONT, (n) => pen.raw(`<g transform="translate(${n.x - n.glyphPx / 2} ${n.y - n.glyphPx / 2}) scale(${n.glyphPx / 16})" color="${n.colour}">${n.glyph}</g>`));
        drawFoot(ctx, rect, source, foot, FONT);
      });
      return download(new Blob([svg], { type: "image/svg+xml" }), name);
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
      async function* bands(): AsyncGenerator<Uint8ClampedArray> {
        for (let y = 0; y < s.h; y += band) {
          const n = Math.min(band, s.h - y);
          ctx!.setTransform(1, 0, 0, 1, 0, 0);
          ctx!.clearRect(0, 0, s.w, band);
          if (bg) {
            ctx!.fillStyle = bg;
            ctx!.fillRect(0, 0, s.w, n);
          }
          C.paintArtBand(ctx!, rect, f, y, n, cam);
          ctx!.setTransform(f, 0, 0, f, -rect.x * f, -(rect.y * f + y));
          drawNotes(ctx!, notes, FONT, (n) => {
            const img = glyphs.get(n.colour + n.glyph);
            if (img?.complete && img.naturalWidth) ctx!.drawImage(img, n.x - n.glyphPx / 2, n.y - n.glyphPx / 2, n.glyphPx, n.glyphPx);
          });
          drawFoot(ctx!, rect, source, foot, FONT);
          yield ctx!.getImageData(0, 0, s.w, n).data;
        }
      }
      download(await encodePng(s.w, s.h, bands()), name);
    } catch {
      this.hooks.say(`This browser could not draw a picture of ${s.w} × ${s.h} pixels: choose a smaller size, or save the SVG.`);
    } finally {
      this.busy = false;
      this.renderPanel();
    }
  }
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
