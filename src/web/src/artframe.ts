// Framing an artwork (ExportSpec decision 19; the picture is drawn in web/src/artwork.ts): a frame
// fixed in the middle of the room the panel leaves, of the shape of the size chosen, the rest of the
// screen shaded. The board under it is the board — the reader pans and zooms it as ever — and once it
// is still the frame shows the picture as it will be. The panel beside it sets the size and the look;
// Save PNG or Save SVG makes the file, in the browser. Esc or Done leaves, the board as it was. The
// choices are the reader's own, kept in their browser; nothing is shared or recorded.

import type { ArtSettings } from "./artwork.ts";
import { artName, artSvg, cleanSettings, encodePng, MAX_SIDE, PRESETS, readPalette, sceneOf } from "./artwork.ts";
import type { GraphCanvas } from "./canvas.ts";
import { escapeHtml } from "./highlight.ts";

export interface ArtHooks {
  /** the view's title, which names the file */
  title(): string;
  /** the settings this browser kept, and keeping them */
  saved(): Partial<ArtSettings> | undefined;
  save(s: ArtSettings): void;
  /** the page's colouring and theme now: a first artwork's */
  now(): { scheme: ArtSettings["scheme"]; theme: ArtSettings["theme"] };
  /** whether declaration `i` (the canvas's numbering) is a target */
  isTarget(i: number): boolean;
  /** the notes the board shows: where each icon is, in the board's world, and its first words */
  notes(): { world: [number, number]; words: string }[];
  say(text: string): void;
  /** framing began or ended: the page puts its panels away, and back */
  framing(on: boolean): void;
}

/** the panel's width, and the room kept around the frame */
const PANEL_W = 300;
const MARGIN = 32;
/** the most pixels a band of a PNG is drawn in at once: what every browser's canvas allows */
const BAND_PIXELS = 4096 * 4096;
/** how long the board must be still before the frame shows the picture */
const STILL_MS = 160;

export class ArtFrame {
  private root: HTMLElement;
  private frameEl: HTMLElement;
  private img: HTMLImageElement;
  private panel: HTMLElement;
  private canvas: GraphCanvas;
  private hooks: ArtHooks;
  private s: ArtSettings | null = null;
  private rect = { x: 0, y: 0, w: 0, h: 0 };
  private cam = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private url: string | null = null;
  private busy = false;
  private measureCtx: CanvasRenderingContext2D | null = null;
  /** where the camera was before framing: where it goes back to */
  private before: { x: number; y: number; k: number } | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };

  constructor(root: HTMLElement, panel: HTMLElement, canvas: GraphCanvas, hooks: ArtHooks) {
    this.root = root;
    this.panel = panel;
    this.canvas = canvas;
    this.hooks = hooks;
    root.innerHTML = `<div class="art-frame"><img class="art-preview" alt="" hidden></div>`;
    this.frameEl = root.querySelector(".art-frame")!;
    this.img = root.querySelector(".art-preview")!;
    panel.addEventListener("change", (e) => this.changed(e.target as HTMLInputElement));
    panel.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-art-done]")) this.close();
      else if (t.closest("[data-art-save]")) void this.saveFile(t.closest<HTMLElement>("[data-art-save]")!.dataset.artSave as "png" | "svg");
    });
    window.addEventListener("resize", () => this.isOpen && this.place());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    if (this.isOpen) return;
    this.s = cleanSettings(this.hooks.saved(), this.hooks.now());
    this.root.hidden = false;
    this.panel.hidden = false;
    this.hooks.framing(true);
    document.addEventListener("keydown", this.onKey, true);
    this.before = { ...this.canvas.cam };
    this.place();
    // the whole board in the frame, to start from
    this.canvas.fitRect(this.rect);
    this.renderPanel();
  }

  close(): void {
    if (!this.isOpen) return;
    this.rect = { x: 0, y: 0, w: 0, h: 0 };
    this.root.hidden = true;
    this.panel.hidden = true;
    document.removeEventListener("keydown", this.onKey, true);
    if (this.timer) clearTimeout(this.timer);
    this.drop();
    this.hooks.framing(false);
    // the board as it was
    if (this.before) this.canvas.jumpTo(this.before);
    this.before = null;
  }

  /** The canvas drew a frame: where the board moved, the picture waits until it is still again. */
  frame(): void {
    if (!this.isOpen) return;
    const c = this.canvas.cam;
    const key = `${c.x.toFixed(2)},${c.y.toFixed(2)},${c.k.toFixed(4)}`;
    if (key === this.cam) return;
    this.cam = key;
    this.img.hidden = true;
    this.later();
  }

  /** The frame in the middle of the room the panel leaves, of the size's shape. */
  private place(): void {
    const s = this.s!;
    const roomW = innerWidth - PANEL_W - 3 * MARGIN, roomH = innerHeight - 2 * MARGIN - 60;
    const scale = Math.min(roomW / s.w, roomH / s.h);
    const w = Math.max(40, s.w * scale), h = Math.max(40, s.h * scale);
    const x = MARGIN + (roomW - w) / 2, y = 60 + MARGIN + (roomH - h) / 2;
    // a frame already there keeps what it showed: the same middle, as much of the board
    const was = this.rect;
    if (was.w > 0 && this.before) {
      const C = this.canvas;
      const [cx, cy] = C.toWorld(was.x + was.w / 2, was.y + was.h / 2);
      const k = C.cam.k * Math.sqrt((w * h) / (was.w * was.h));
      const { w: sw, h: sh } = C.screen;
      C.jumpTo({ x: cx - (x + w / 2 - sw / 2) / k, y: cy - (y + h / 2 - sh / 2) / k, k });
    }
    this.rect = { x, y, w, h };
    Object.assign(this.frameEl.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    this.img.hidden = true;
    this.later();
  }

  private later(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.preview();
    }, STILL_MS);
  }

  private measure = (text: string, font: string): number => {
    this.measureCtx ??= document.createElement("canvas").getContext("2d");
    const c = this.measureCtx;
    if (!c) return text.length * 6;
    c.font = font;
    return c.measureText(text).width;
  };

  /** The picture, as the file will hold it, at the frame's size. */
  private svg(size: { w: number; h: number }): string {
    const s = this.s!;
    const scene = sceneOf(this.canvas, this.rect, { proofs: s.proofs, targets: (i) => this.hooks.isTarget(i), notes: () => this.hooks.notes() });
    return artSvg(scene, readPalette(s.theme), { ...s, ...size }, this.measure);
  }

  private preview(): void {
    if (!this.isOpen) return;
    const svg = this.svg({ w: Math.round(this.rect.w), h: Math.round(this.rect.h) });
    this.drop();
    this.url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    this.img.onload = () => (this.img.hidden = false);
    this.img.src = this.url;
  }

  private drop(): void {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }

  private changed(t: HTMLInputElement): void {
    const s = this.s!;
    const k = t.dataset.art;
    if (!k) return;
    const sized = k === "preset" || k === "w" || k === "h";
    if (k === "preset") {
      const p = PRESETS[Number(t.value)];
      if (p) [s.w, s.h] = [p.w, p.h];
    } else if (k === "w" || k === "h") s[k] = Math.max(16, Math.min(MAX_SIDE, Math.round(Number(t.value)) || s[k]));
    else if (k === "proofs" || k === "notes" || k === "selection") s[k] = t.checked;
    else (s as unknown as Record<string, string>)[k] = t.value;
    this.hooks.save(s);
    this.place();
    if (sized) this.renderPanel();
  }

  private renderPanel(): void {
    const s = this.s!;
    const opt = (v: string, label: string, cur: string) => `<option value="${v}"${v === cur ? " selected" : ""}>${label}</option>`;
    const sel = (k: keyof ArtSettings, label: string, opts: [string, string][]) =>
      `<label class="ex-field"><span>${label}</span><select data-art="${k}">${opts.map(([v, l]) => opt(v, l, String(s[k]))).join("")}</select></label>`;
    const check = (k: "proofs" | "notes" | "selection", label: string) => `<label class="ex-check"><input type="checkbox" data-art="${k}"${s[k] ? " checked" : ""}> ${label}</label>`;
    const preset = PRESETS.findIndex((p) => p.w === s.w && p.h === s.h);
    const mp = ((s.w * s.h) / 1e6).toFixed(1);
    this.panel.innerHTML =
      `<div class="ex-head"><div class="modal-title">Artwork</div><button class="icon" data-art-done title="Done (Esc)">✕</button></div>` +
      `<div class="modal-text">Pan and zoom the board under the frame: what is in it is drawn, at the size chosen. The frame shows the picture once the board is still.</div>` +
      `<div class="art-grid">` +
      `<label class="ex-field ex-wide"><span>Size</span><select data-art="preset"><option value="-1"${preset < 0 ? " selected" : ""}>Custom</option>${PRESETS.map((p, i) => `<option value="${i}"${i === preset ? " selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}</select></label>` +
      `<label class="ex-field"><span>Width</span><input type="number" min="16" max="${MAX_SIDE}" step="1" data-art="w" value="${s.w}"></label>` +
      `<label class="ex-field"><span>Height</span><input type="number" min="16" max="${MAX_SIDE}" step="1" data-art="h" value="${s.h}"></label>` +
      `<div class="art-note muted">${s.w} × ${s.h} px, ${mp} megapixels; a name is ${Math.round((11 * s.w) / Math.max(this.rect.w, 1))} px high in it.</div>` +
      sel("scheme", "Colouring", [["kind", "Kind"], ["status", "Status"]]) +
      sel("theme", "Theme", [["light", "Light"], ["dark", "Dark"]]) +
      sel("background", "Background", [["theme", "The theme's"], ["white", "White"], ["transparent", "Transparent"]]) +
      sel("labels", "Names", [["all", "All"], ["clusters", "Clusters only"], ["none", "None"]]) +
      sel("edges", "Edges", [["all", "All"], ["selection", "The selection's"], ["none", "None"]]) +
      sel("targets", "Targets", [["marked", "Star and name"], ["plain", "As any"], ["highlight", "Alone, the rest faded"]]) +
      `<div class="ex-checks">${check("proofs", "Proof edges")}${check("notes", "Notes")}${check("selection", "The selection, as you see it")}</div>` +
      `</div>` +
      `<div class="modal-actions"><button class="rv-btn" data-art-done>Done</button><button class="rv-btn" data-art-save="svg"${this.busy ? " disabled" : ""}>Save SVG</button><button class="rv-btn primary" data-art-save="png"${this.busy ? " disabled" : ""}>Save PNG</button></div>`;
  }

  /** Make the file, at the full size, and hand it to the browser to save. */
  private async saveFile(kind: "png" | "svg"): Promise<void> {
    if (this.busy) return;
    const s = this.s!;
    const svg = this.svg({ w: s.w, h: s.h });
    const name = artName(this.hooks.title(), kind);
    if (kind === "svg") return download(new Blob([svg], { type: "image/svg+xml" }), name);
    this.busy = true;
    this.renderPanel();
    try {
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      const img = new Image();
      img.src = url;
      await img.decode();
      // drawn a band of rows at a time, as large a band as the browser draws at once
      const band = Math.max(1, Math.min(s.h, Math.floor(BAND_PIXELS / s.w)));
      const cv = document.createElement("canvas");
      cv.width = s.w;
      cv.height = band;
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("no canvas");
      async function* bands(): AsyncGenerator<Uint8ClampedArray> {
        for (let y = 0; y < s.h; y += band) {
          const n = Math.min(band, s.h - y);
          ctx!.clearRect(0, 0, s.w, band);
          ctx!.drawImage(img, 0, -y, s.w, s.h);
          yield ctx!.getImageData(0, 0, s.w, n).data;
        }
      }
      const blob = await encodePng(s.w, s.h, bands());
      URL.revokeObjectURL(url);
      download(blob, name);
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
