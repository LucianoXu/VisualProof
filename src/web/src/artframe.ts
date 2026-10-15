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
import { artName, artSvg, cleanSettings, drawFoot, drawNotes, encodePng, glyphSvg, MAX_SIDE, nameRows, oriented, PRESETS, presetOf, themeBackground, withChosen } from "./artwork.ts";
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
  /** every target of the review, by full name, with the name the board writes */
  targets(): { name: string; label: string }[];
  say(text: string): void;
}

/** the panel's width, and the room kept around the frame */
const PANEL_W = 300;
const MARGIN = 32;
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
    panel.addEventListener("input", (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.artFilter === undefined) return;
      this.filter = t.value;
      this.renderRows();
    });
    panel.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-art-done]")) this.close();
      else if (t.closest("[data-art-save]")) void this.saveFile(t.closest<HTMLElement>("[data-art-save]")!.dataset.artSave as "png" | "svg");
      else if (t.closest("[data-art-pick]")) this.pick(t.closest<HTMLElement>("[data-art-pick]")!.dataset.artPick!);
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
    // the filter over the names is the reader's own (the panel's `input`)
    if (t.dataset.artFilter !== undefined) return;
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
    else if (k === "w" || k === "h") s[k] = Math.max(16, Math.min(MAX_SIDE, Math.round(Number(t.value)) || s[k]));
    else if (k === "look") {
      // the theme, on its background or on none
      const [theme, clear] = t.value.split("-");
      s.theme = theme === "dark" ? "dark" : "light";
      s.background = clear ? "transparent" : "theme";
    } else if (k === "proofs" || k === "notes" || k === "selection" || k === "source" || k === "keys") s[k] = t.checked;
    else {
      (s as unknown as Record<string, string>)[k] = t.value;
      // by selection, from what was drawn: As shown, nothing hidden or added; every target
      if (k === "labels" && t.value === "chosen") {
        [s.namesFrom, s.hiddenNames, s.shownNames] = ["board", [], []];
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
   *  same. What does not fit in what the artwork carries is left out, and said. */
  private chooseNames(ids: readonly string[], on: boolean): void {
    const s = this.s;
    if (!s || this.busy) return this.renderPanel();
    const now = this.canvas.writtenNames();
    const hidden = new Set(s.hiddenNames), shown = new Set(s.shownNames);
    const add: string[] = [], hide: string[] = [];
    for (const id of ids) {
      if (on) {
        hidden.delete(id);
        if (!now.has(id) && !shown.has(id)) add.push(id);
      } else if (shown.has(id)) shown.delete(id);
      else if (s.namesFrom === "board" && now.has(id)) hide.push(id);
    }
    const a = withChosen([...shown], add, ART_NAMES_BYTES), h = withChosen([...hidden], hide, ART_NAMES_BYTES);
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
    if (!this.filter.trim()) {
      if (this.busy) return this.renderPanel();
      [s.namesFrom, s.hiddenNames, s.shownNames] = [all === "all" ? "board" : "none", [], []];
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
    return `${here.toLocaleString("en")} of ${this.rows.length.toLocaleString("en")} in the frame written${s?.namesFrom === "none" ? " · from none" : ""}${n(s?.hiddenNames.length ?? 0, "hidden")}${n(s?.shownNames.length ?? 0, "shown besides")}`;
  }

  /** The foot in the frame, as the files will have it: "Generated by VisualProof" at the bottom
   *  left, and where asked the source and commit at the bottom right (artwork.ts, drawFoot). */
  private renderFoot(): void {
    const s = this.s;
    const el = this.frameEl.querySelector<HTMLElement>(".art-foot")!;
    const source = s?.source ? this.hooks.source() : null;
    el.innerHTML = `<span>Generated by <b class="logo">VisualProof</b></span>${source ? `<span>${escapeHtml(source)}</span>` : ""}`;
  }

  private renderPanel(held = false): void {
    const s = this.s;
    if (!s) return;
    this.renderFoot();
    // what the reader was at in the panel, kept: the lists' scroll, the control with the focus
    const scrolls = [...this.panel.querySelectorAll<HTMLElement>("[data-art-rows]")].map((el) => [el.dataset.artRows!, el.scrollTop] as const);
    const was = document.activeElement instanceof HTMLElement && this.panel.contains(document.activeElement) ? document.activeElement : null;
    const mark = was && ["art", "artName", "artTarget", "artPick", "artFilter"].find((k) => was.dataset[k] !== undefined);
    const caret = was instanceof HTMLInputElement && mark === "artFilter" ? [was.selectionStart, was.selectionEnd] : null;
    if (s.labels === "chosen") this.readRows(held);
    const opt = (v: string, label: string, cur: string) => `<option value="${v}"${v === cur ? " selected" : ""}>${label}</option>`;
    const sel = (k: keyof ArtSettings, label: string, opts: [string, string][]) =>
      `<label class="ex-field"><span>${label}</span><select data-art="${k}">${opts.map(([v, l]) => opt(v, l, String(s[k]))).join("")}</select></label>`;
    const check = (k: "proofs" | "notes" | "selection" | "source" | "keys", label: string, title = "", off = false) =>
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
      sel("labels", "Names", [["board", "As shown"], ["clusters", "Clusters only"], ["none", "None"], ["chosen", "By selection"]]) +
      (s.labels === "chosen" ? this.namesHtml() : "") +
      sel("edges", "Edges", [["all", "All"], ["selection", "The selection's"], ["none", "None"]]) +
      sel("targets", "Targets", [["marked", "Star and name"], ["plain", "As any"], ["highlight", "Alone, the rest faded"], ["chosen", "By selection"]]) +
      (s.targets === "chosen" ? this.targetsHtml() : "") +
      `<div class="ex-checks">${check("keys", "Key marks", "The key declarations' diamonds; with the targets by selection, those of the targets ticked")}${check("proofs", "Proof edges")}${check("notes", "Notes")}${check("selection", "The selection, as you see it")}` +
      check("source", "Source and commit, at the bottom right", source ?? "This project is not a git repository", !source) +
      `</div>` +
      `</div>` +
      `<div class="modal-actions"><button class="rv-btn" data-art-done>Done</button><button class="rv-btn" data-art-save="svg"${this.busy ? " disabled" : ""}>Save SVG</button><button class="rv-btn primary" data-art-save="png"${this.busy ? " disabled" : ""}>${this.busy ? "Saving…" : "Save PNG"}</button></div>`;
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
