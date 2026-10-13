// What the reference window draws (AttachmentSpec decision 11): a PDF of the library drawn by
// pdf.js, bundled into the page — no outside service sees the files — a page at a time as it comes
// into sight, so that a long paper opens at once; the links into it lit — a region as a box, a
// quote with no region as the words it quotes — and, in the margin of each page, the subjects
// linked to places on it, which take the reader back to the board. An image of the library is
// shown in the same place, zoomed and moved as the canvas is.
//
// A page's text is the server's (the owner's decision of 2026-10-11): the words poppler reads with
// their boxes (server/poppler.ts), asked for a page at a time as it is drawn, by which a quote is
// found, a search is answered and drawn as boxes, a box's words are its quote, and the page's text
// is laid over it to select (web/src/paperwords.ts). pdf.js draws and does nothing else: its text
// extraction fails in Safari. pdf.js is its legacy build, made for such browsers (its modern one
// uses what Safari lacks).
//
// A drag on a page selects its text, as in any PDF reader, and makes nothing (the owner's decision
// of 2026-10-12); the wheel and the scroll bars move the pages. The box is a tool: armed by the
// window (web/src/paperwin.ts) for the next drag alone, that drag draws a box, a place to link to —
// a page with the region and the quote of the words inside it, or a region of an image — and the
// tool disarms. A plain drag on an image, which has no text, moves it. Regions are in the page's
// own fractions (shared/library.ts), whatever the zoom.
//
// The window around it (web/src/paperwin.ts) says what to show, reads the server for it, and is
// told what the reader does.

import { getDocument, GlobalWorkerOptions, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.min.mjs";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { lineRects, placeOnPage, quoteInRegion, roundRegion } from "../../shared/library.ts";
import type { LinkPlace, Region, Word } from "../../shared/library.ts";
import { Clicks, copyText, lineOf, nearestWord, notAfter, pressKind, selectedRects, TextDrag, wordSpans } from "./paperwords.ts";
import type { WordPos } from "./paperwords.ts";

// pdf.js's worker is bundled beside the page's own (server/pipeline.ts, bundlePage) and served by the server
GlobalWorkerOptions.workerSrc = "/pdfworker.js";

/** A link as the paper draws it: where it is, what it is about, and whether it is the one lit. A
 *  mark with no id and no subject is no link: the clip a note carries, lit where it was opened from
 *  (AttachmentSpec decision 12), which leads nowhere and has no marker in the margin. */
export interface PaperMark extends LinkPlace {
  id: string;
  subject: string;
  label: string;
  lit: boolean;
}

/** A page's words as the server reads them, and where each line starts among them. */
export interface PageWords {
  words: Word[];
  lines: number[];
}

/** A match of a search, as the server finds it in the pages' words: its page and its words' boxes. */
export interface Hit {
  page: number;
  boxes: Region[];
}

export interface PaperViewHooks {
  /** what the reader picked changed: a place to link to and where on the screen it is, or nothing */
  picked(place: LinkPlace | null, at: DOMRect | null): void;
  /** a marker in a page's margin was clicked: its subject on the board */
  goSubject(subject: string): void;
  /** a link drawn on the paper was clicked */
  openLink(id: string): void;
  /** the page in sight changed, or the number of pages became known */
  paged(page: number, pages: number): void;
  /** a subject in the few words a margin marker has room for */
  marginLabel(subject: string): string;
  /** a page's words, from the server; null where they cannot be read (an image of a scan, a server
   *  that lacks the file) */
  words(page: number): Promise<PageWords | null>;
  /** every match of a text in the file's words, from the server, and whether there were more than
   *  it answers; null where the server cannot search it */
  search(q: string): Promise<{ hits: Hit[]; more: boolean } | null>;
  /** whether the box tool is armed: the next drag draws a box */
  boxing(): boolean;
  /** a box was drawn with the tool, which disarms */
  boxed(): void;
}

/** how far beyond what is in sight pages are drawn ahead, in pixels */
const AHEAD = 900;
/** the most pages kept drawn at once: those further from sight are let go */
const KEEP = 12;
/** the gap between pages, in pixels */
const GAP = 12;
const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
/** the least a drag goes, in pixels, to draw a box or to move an image: less is a click */
const BOX_PX = 6;
/** how near the window's top or bottom, in pixels, a text drag scrolls the pages, and the most it
 *  scrolls them in a frame */
const EDGE = 16;
const ROLL_MAX = 40;
/** the font the words' layer is drawn in (web/style.css, .pw-words), by which its letters are
 *  stretched to their words' boxes */
const WORD_FONT = "sans-serif";

let measurer: CanvasRenderingContext2D | null = null;
/** The width of a text in the words' layer's font, its letters 1 px tall. */
function measure(text: string): number {
  if (!measurer) {
    measurer = document.createElement("canvas").getContext("2d");
    if (!measurer) return 0;
    measurer.font = `100px ${WORD_FONT}`;
  }
  return measurer.measureText(text).width / 100;
}

interface Page {
  n: number;
  el: HTMLElement;
  canvas: HTMLCanvasElement | null;
  /** its words laid over it to select, built while it is drawn; and what is selected of them, lit */
  words: HTMLElement | null;
  sel: HTMLElement;
  marks: HTMLElement;
  hits: HTMLElement;
  margin: HTMLElement;
  /** its size at scale 1, once known (the first page's until then) */
  w: number;
  h: number;
  known: boolean;
  /** drawn at this scale; 0: not drawn */
  drawn: number;
  task: RenderTask | null;
}

const fit = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The box around several rects. */
function around(rs: readonly Region[]): Region | null {
  if (!rs.length) return null;
  return [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1])), Math.max(...rs.map((r) => r[2])), Math.max(...rs.map((r) => r[3]))];
}

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

/** A box over a page or an image, at a region of it. */
function boxAt(r: Region, cls: string): HTMLElement {
  const d = document.createElement("div");
  d.className = cls;
  Object.assign(d.style, { left: pct(r[0]), top: pct(r[1]), width: pct(r[2] - r[0]), height: pct(r[3] - r[1]) });
  return d;
}

/** The common part of a PDF's view and an image's: the marks, the box being dragged, the picked
 *  place. */
abstract class View {
  protected hooks: PaperViewHooks;
  readonly scroller: HTMLElement;
  protected marks: PaperMark[] = [];
  /** the box being drawn, so that one drawn before it, whose words come later, is not picked */
  private boxTurn = 0;

  constructor(host: HTMLElement, hooks: PaperViewHooks) {
    this.hooks = hooks;
    this.scroller = document.createElement("div");
    this.scroller.className = "pw-scroll";
    host.append(this.scroller);
  }

  abstract show(place: LinkPlace | null): void;
  abstract setMarks(marks: PaperMark[]): void;
  abstract zoom(by: number | "fit"): void;
  abstract destroy(): void;

  /** What a box picked on page `page` adds to its region: the quote of the words inside it, where
   *  the page's words are known (an image has none). */
  protected async placeOfBox(_page: number | undefined, _r: Region): Promise<Partial<LinkPlace>> {
    return {};
  }

  /** The link drawn on `root` (a page, the image) at a point of the screen, the one drawn last where
   *  several are; null for none. Read from where the links are drawn, not from what the pointer is
   *  on: a PDF's links let the presses through to its words. */
  protected linkAt(root: HTMLElement, x: number, y: number): HTMLElement | null {
    let hit: HTMLElement | null = null;
    for (const m of root.querySelectorAll<HTMLElement>("[data-pw-link]")) {
      const r = m.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hit = m;
    }
    return hit;
  }

  /** A drag with the box tool armed that draws a box on `surface` (a page, the image): the region it
   *  covers there, picked with the words inside it; the tool then disarms. A press that hardly
   *  moves is a click, which leaves the tool armed: on a link drawn there it opens the link,
   *  elsewhere what was picked goes. Mouse and pen draw; a touch scrolls, as it does on a page. */
  protected dragBox(e: PointerEvent, surface: HTMLElement, page: number | undefined): void {
    const box = surface.getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY;
    let el: HTMLElement | null = null;
    const region = (x: number, y: number): Region =>
      roundRegion([fit((Math.min(x, x0) - box.left) / box.width, 0, 1), fit((Math.min(y, y0) - box.top) / box.height, 0, 1), fit((Math.max(x, x0) - box.left) / box.width, 0, 1), fit((Math.max(y, y0) - box.top) / box.height, 0, 1)]);
    const far = (x: number, y: number) => Math.abs(x - x0) >= BOX_PX || Math.abs(y - y0) >= BOX_PX;
    const move = (ev: PointerEvent) => {
      if (!el) {
        if (!far(ev.clientX, ev.clientY)) return;
        this.clearDrag();
        el = document.createElement("div");
        el.className = "pw-drag";
        surface.append(el);
      }
      const r = region(ev.clientX, ev.clientY);
      Object.assign(el.style, { left: pct(r[0]), top: pct(r[1]), width: pct(r[2] - r[0]), height: pct(r[3] - r[1]) });
    };
    const up = (ev: PointerEvent) => {
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerup", up);
      surface.removeEventListener("pointercancel", up);
      if (surface.hasPointerCapture(ev.pointerId)) surface.releasePointerCapture(ev.pointerId);
      const turn = ++this.boxTurn;
      if (!el || ev.type === "pointercancel") {
        el?.remove();
        // a click: on a link drawn there, the link opens
        const l = ev.type === "pointerup" ? this.linkAt(surface, ev.clientX, ev.clientY) : null;
        if (l) return this.hooks.openLink(l.dataset.pwLink!);
        this.clearDrag();
        return this.hooks.picked(null, null);
      }
      const drawn = el;
      drawn.classList.add("done");
      // the tool was for this drag alone
      this.hooks.boxed();
      const r = region(ev.clientX, ev.clientY);
      const at = drawn.getBoundingClientRect();
      // the words inside it come from the server: picked once they are known, or without them
      void this.placeOfBox(page, r)
        .catch(() => ({}))
        .then((more) => {
          if (turn !== this.boxTurn || !drawn.isConnected) return;
          this.hooks.picked({ ...(page ? { page } : {}), region: r, ...more }, at);
        });
    };
    surface.setPointerCapture(e.pointerId);
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerup", up);
    surface.addEventListener("pointercancel", up);
  }

  /** The box dragged last goes (a new pick, or none). */
  clearDrag(): void {
    this.boxTurn++;
    this.scroller.querySelectorAll(".pw-drag").forEach((d) => d.remove());
  }

  /** The margin's markers of one page or image: the subjects linked to places on it, each at the
   *  height of its first place there, one marker per subject. */
  protected drawMargin(margin: HTMLElement, marks: readonly PaperMark[], top: (m: PaperMark) => number): void {
    margin.textContent = "";
    const seen = new Map<string, number>();
    for (const m of marks) {
      if (!m.subject) continue;
      const y = top(m);
      if (!seen.has(m.subject) || y < seen.get(m.subject)!) seen.set(m.subject, y);
    }
    const lit = new Set(marks.filter((m) => m.lit).map((m) => m.subject));
    let last = -1;
    for (const [subject, y0] of [...seen].sort((a, b) => a[1] - b[1])) {
      // markers keep apart, each under the one above
      const y = Math.max(y0, last + 0.028);
      last = y;
      const b = document.createElement("button");
      b.className = `pw-marker${lit.has(subject) ? " lit" : ""}`;
      b.dataset.pwSubject = subject;
      b.style.top = pct(fit(y, 0, 0.97));
      b.textContent = this.hooks.marginLabel(subject);
      b.title = `Linked here: ${subject} — go to it on the board`;
      margin.append(b);
    }
  }
}

/** A PDF, drawn a page at a time. */
export class PdfView extends View {
  private task: PDFDocumentLoadingTask | null = null;
  private pdf: PDFDocumentProxy | null = null;
  private pages: Page[] = [];
  private scale = 1;
  /** fitted to the window's width until the reader zooms */
  private fitted = true;
  private watch: IntersectionObserver | null = null;
  private resize: ResizeObserver | null = null;
  private wanted = new Set<number>();
  private current = 1;
  /** where to go once the pages are known */
  private pending: LinkPlace | null = null;
  /** the place gone to last: a quote found later moves there only if no other was gone to since */
  private going = 0;
  /** each page's words, asked of the server once, and those that came */
  private asked = new Map<number, Promise<PageWords | null>>();
  private known = new Map<number, PageWords | null>();
  private hitList: Hit[] = [];
  private hit = -1;
  private gone = false;
  /** clicks in a row on the pages: a double click selects a word, a triple its line */
  private clicks = new Clicks();
  /** the page whose link the pointer is over, shown by the cursor and the link's label */
  private overLink: HTMLElement | null = null;
  /** the selection drawn again at the next frame, and the pages it is drawn on */
  private selWait = 0;
  private selOn = new Set<Page>();

  constructor(host: HTMLElement, hooks: PaperViewHooks) {
    super(host, hooks);
    this.scroller.classList.add("pw-pdf");
    this.scroller.addEventListener("scroll", () => this.scrolled(), { passive: true });
    // a drag on a page selects its text, wherever it starts (a link's region too: a click on that
    // opens it); with the box tool armed it draws a box; a marker in the margin is a button of its
    // own. Where a selection starts and ends is decided from the words' boxes, not by the browser,
    // which would start one of its own here: the press is the page's
    this.scroller.addEventListener("pointerdown", (e) => {
      const t = e.target as HTMLElement;
      const page = t.closest<HTMLElement>(".pw-page");
      if (!page) return;
      const kind = pressKind({ armed: this.hooks.boxing(), image: false, pointer: e.pointerType, button: e.button, marker: !!t.closest(".pw-marker") });
      if (!kind) return;
      e.preventDefault();
      if (kind === "text") return this.dragText(e, page);
      // a box drawn lets go of what was selected, as a press anywhere on a page does
      document.getSelection()?.removeAllRanges();
      this.dragBox(e, page, Number(page.dataset.n));
    });
    this.scroller.addEventListener("selectstart", (e) => {
      const t = e.target instanceof Element ? e.target : (e.target as Node | null)?.parentElement;
      if (t?.closest(".pw-page")) e.preventDefault();
    });
    // a link's region lets presses through to the words under it: the cursor and its label say it
    // is there all the same
    this.scroller.addEventListener("pointermove", (e) => {
      if (e.buttons || e.pointerType === "touch") return;
      const page = (e.target as HTMLElement).closest<HTMLElement>(".pw-page");
      this.hoverLink(page && !(e.target as HTMLElement).closest(".pw-marker") ? page : null, e.clientX, e.clientY);
    });
    this.scroller.addEventListener("pointerleave", () => this.hoverLink(null, 0, 0));
    document.addEventListener("copy", this.copied);
    document.addEventListener("selectionchange", this.selectionChanged);
    this.scroller.addEventListener("click", (e) => {
      const m = (e.target as HTMLElement).closest<HTMLElement>("[data-pw-subject]");
      if (m) this.hooks.goSubject(m.dataset.pwSubject!);
    });
    this.scroller.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        this.zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
      },
      { passive: false },
    );
  }

  /** Load the PDF at `url`; the pages are laid out at once, drawn as they come into sight. */
  async open(url: string): Promise<void> {
    this.task = getDocument({
      url,
      enableXfa: false,
      // nothing in the console in normal use: a font pdf.js stands in for is no news to the reader
      verbosity: VerbosityLevel.ERRORS,
      // what some PDFs need besides themselves, served by the server from pdf.js's own package
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      wasmUrl: "/pdfjs/wasm/",
      iccUrl: "/pdfjs/iccs/",
    });
    this.pdf = await this.task.promise;
    if (this.gone) return void this.task.destroy();
    const first = await this.pdf.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    const n = this.pdf.numPages;
    for (let k = 1; k <= n; k++) this.pages.push(this.makePage(k, vp.width, vp.height));
    this.pages[0].known = true;
    this.watch = new IntersectionObserver((es) => this.seen(es), { root: this.scroller, rootMargin: `${AHEAD}px 0px` });
    for (const p of this.pages) this.watch.observe(p.el);
    this.resize = new ResizeObserver(() => {
      if (this.fitted) this.fitWidth();
    });
    this.resize.observe(this.scroller);
    this.fitWidth();
    this.hooks.paged(1, n);
    // the marks and the search's matches are boxes in the page's fractions: drawn on every page at
    // once, whether its picture is drawn yet or not
    for (const p of this.pages) this.drawMarks(p);
    this.drawHits();
    if (this.pending) this.show(this.pending);
  }

  get pageCount(): number {
    return this.pdf?.numPages ?? 0;
  }

  get page(): number {
    return this.current;
  }

  private makePage(n: number, w: number, h: number): Page {
    const el = document.createElement("div");
    el.className = "pw-page";
    el.dataset.n = String(n);
    const marks = document.createElement("div");
    marks.className = "pw-marks";
    const hits = document.createElement("div");
    hits.className = "pw-hits";
    const sel = document.createElement("div");
    sel.className = "pw-sel";
    const margin = document.createElement("div");
    margin.className = "pw-margin";
    const num = document.createElement("div");
    num.className = "pw-num";
    num.textContent = String(n);
    el.append(sel, hits, marks, margin, num);
    this.scroller.append(el);
    return { n, el, canvas: null, words: null, sel, marks, hits, margin, w, h, known: false, drawn: 0, task: null };
  }

  /** Each page's box at the scale now, its place kept as it is in sight; the letters of its words'
   *  layer are sized by its height (`--pw-ph`), so that the layer follows the zoom unbuilt. */
  private layout(): void {
    const s = this.scale;
    for (const p of this.pages) {
      p.el.style.width = `${Math.floor(p.w * s)}px`;
      p.el.style.height = `${Math.floor(p.h * s)}px`;
      p.el.style.setProperty("--pw-ph", `${Math.floor(p.h * s)}px`);
    }
  }

  private fitWidth(): void {
    const w = this.scroller.clientWidth - 2 * GAP;
    const page = this.pages[this.current - 1] ?? this.pages[0];
    if (!page || w <= 0) return;
    this.setScale(fit(w / page.w, MIN_SCALE, MAX_SCALE));
  }

  private setScale(s: number): void {
    if (Math.abs(s - this.scale) < 1e-3 && this.pages[0]?.el.style.width) return;
    // the place in sight stays in sight
    const p = this.pages[this.current - 1];
    const within = p ? (this.scroller.scrollTop - p.el.offsetTop) / Math.max(1, p.el.offsetHeight) : 0;
    this.scale = s;
    this.layout();
    for (const q of this.pages) if (q.drawn && q.drawn !== s) this.wanted.add(q.n);
    if (p) this.scroller.scrollTop = p.el.offsetTop + within * p.el.offsetHeight;
    this.drawWanted();
  }

  zoom(by: number | "fit"): void {
    if (!this.pdf) return;
    if (by === "fit") {
      this.fitted = true;
      return this.fitWidth();
    }
    this.fitted = false;
    this.setScale(fit(this.scale * by, MIN_SCALE, MAX_SCALE));
  }

  private seen(es: IntersectionObserverEntry[]): void {
    for (const e of es) {
      const n = Number((e.target as HTMLElement).dataset.n);
      if (e.isIntersecting) this.wanted.add(n);
      else this.wanted.delete(n);
    }
    this.drawWanted();
  }

  private scrolled(): void {
    const top = this.scroller.scrollTop + this.scroller.clientHeight / 3;
    let at = 1;
    for (const p of this.pages) {
      if (p.el.offsetTop <= top) at = p.n;
      else break;
    }
    if (at !== this.current) {
      this.current = at;
      this.hooks.paged(at, this.pages.length);
    }
  }

  /** Draw the pages in sight not yet drawn at this scale; let go of those far away. */
  private drawWanted(): void {
    for (const n of this.wanted) {
      const p = this.pages[n - 1];
      if (p && p.drawn !== this.scale && !p.task) void this.draw(p);
    }
    const drawn = this.pages.filter((p) => p.drawn && !this.wanted.has(p.n));
    if (drawn.length + this.wanted.size > KEEP)
      for (const p of drawn.sort((a, b) => Math.abs(b.n - this.current) - Math.abs(a.n - this.current)).slice(0, drawn.length + this.wanted.size - KEEP)) this.forget(p);
  }

  private forget(p: Page): void {
    p.task?.cancel();
    p.task = null;
    p.canvas?.remove();
    p.canvas = null;
    p.drawn = 0;
    // its words go with its picture, unless what is selected is on it
    if (p.words && !document.getSelection()?.containsNode(p.words, true)) {
      p.words.remove();
      p.words = null;
    }
  }

  /** A page drawn at the scale now: its canvas; and its words asked for, laid over it to select and
   *  lighting the links on it that are a quote with no region. */
  private async draw(p: Page): Promise<void> {
    if (!this.pdf) return;
    const scale = this.scale;
    let page: PDFPageProxy;
    try {
      page = await this.pdf.getPage(p.n);
    } catch {
      return;
    }
    if (this.gone) return;
    if (!p.known) {
      const one = page.getViewport({ scale: 1 });
      p.w = one.width;
      p.h = one.height;
      p.known = true;
      this.layout();
    }
    const vp = page.getViewport({ scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const canvas = document.createElement("canvas");
    canvas.className = "pw-canvas";
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = `${Math.floor(vp.width)}px`;
    canvas.style.height = `${Math.floor(vp.height)}px`;
    const task = page.render({ canvas, viewport: vp, ...(dpr !== 1 ? { transform: [dpr, 0, 0, dpr, 0, 0] } : {}) });
    p.task = task;
    try {
      await task.promise;
    } catch {
      // cancelled (a newer drawing, or the page let go), or a page pdf.js cannot draw
      if (p.task === task) p.task = null;
      return;
    }
    if (p.task !== task || this.gone) return;
    p.task = null;
    p.canvas?.remove();
    p.canvas = canvas;
    p.el.prepend(canvas);
    p.drawn = scale;
    // its words: laid over it to select, and the quotes of links with no region lit by them
    void this.wordsOf(p.n)
      .then(() => {
        if (this.gone) return;
        this.buildWords(p);
        if (this.marks.some((m) => m.page === p.n && m.quote && !m.region)) this.drawMarks(p);
      })
      .catch(() => {});
  }

  /** A page's words laid over its picture, once, while it is drawn: a transparent span a word at its
   *  box, in reading order, sized by the page (web/src/paperwords.ts); nothing where its words
   *  cannot be read (a scan). */
  private buildWords(p: Page): void {
    const w = this.known.get(p.n);
    if (p.words || !p.drawn || !w?.words.length) return;
    const layer = document.createElement("div");
    layer.className = "pw-words";
    for (const s of wordSpans(w, p.w / p.h, measure)) {
      const span = document.createElement("span");
      span.textContent = s.text;
      span.style.cssText = `left:${pct(s.left)};top:${pct(s.top)};font-size:calc(var(--pw-ph) * ${s.size.toFixed(5)});transform:scaleX(${s.stretch.toFixed(4)});word-spacing:${s.spacing.toFixed(3)}em`;
      layer.append(span);
    }
    p.el.insertBefore(layer, p.sel);
    p.words = layer;
  }

  // ---------------------------------------------------------------- selecting text

  /** A press on a page with the box tool disarmed: what was picked goes, and the drag selects text
   *  (web/src/paperwords.ts, TextDrag), scrolling the pages where it goes past the window's top or
   *  bottom; a click opens the link there, a double click selects a word, a triple its line. */
  private dragText(e: PointerEvent, pageEl: HTMLElement): void {
    this.clearDrag();
    this.hooks.picked(null, null);
    // the window takes the keys, so that ⌘C copies what is selected here and Esc is the window's
    const win = this.scroller.closest<HTMLElement>(".pw-win");
    if (win && document.activeElement !== win) win.focus({ preventScroll: true });
    const n = Number(pageEl.dataset.n);
    const r0 = pageEl.getBoundingClientRect();
    const fx = (e.clientX - r0.left) / r0.width, fy = (e.clientY - r0.top) / r0.height;
    const from = e.shiftKey ? this.selectionStart() : null;
    const drag = new TextDrag(
      e.clientX,
      e.clientY,
      {
        // where it was pressed on its page, read once the page's words are there
        anchor: () => from ?? this.posOnPage(n, fx, fy),
        posAt: (x, y) => this.posAt(x, y),
        select: (a, b) => this.select(a, b),
        click: (x, y) => this.clickAt(pageEl, x, y),
      },
      !!from,
    );
    let at = { x: e.clientX, y: e.clientY };
    let rolling = 0;
    // past the window's top or bottom the pages scroll, the faster the further, and the selection
    // follows
    const roll = () => {
      rolling = 0;
      const r = this.scroller.getBoundingClientRect();
      const d = at.y < r.top + EDGE ? at.y - r.top - EDGE : at.y > r.bottom - EDGE ? at.y - r.bottom + EDGE : 0;
      if (!d) return;
      this.scroller.scrollTop += Math.max(-ROLL_MAX, Math.min(ROLL_MAX, d / 2));
      drag.move(at.x, at.y);
      rolling = requestAnimationFrame(roll);
    };
    const move = (ev: PointerEvent) => {
      at = { x: ev.clientX, y: ev.clientY };
      drag.move(at.x, at.y);
      if (drag.moved && !rolling) rolling = requestAnimationFrame(roll);
    };
    const up = (ev: PointerEvent) => {
      this.scroller.removeEventListener("pointermove", move);
      this.scroller.removeEventListener("pointerup", up);
      this.scroller.removeEventListener("pointercancel", up);
      if (this.scroller.hasPointerCapture(ev.pointerId)) this.scroller.releasePointerCapture(ev.pointerId);
      cancelAnimationFrame(rolling);
      rolling = 0;
      if (ev.type === "pointerup") drag.up(ev.clientX, ev.clientY);
    };
    this.scroller.setPointerCapture(e.pointerId);
    this.scroller.addEventListener("pointermove", move);
    this.scroller.addEventListener("pointerup", up);
    this.scroller.addEventListener("pointercancel", up);
  }

  /** A click on a page: the first lets go of what is selected and opens the link drawn there, unless
   *  it is the one lit already (the reader reading it is not moved); the second selects the word
   *  there, the third its line. */
  private clickAt(pageEl: HTMLElement, x: number, y: number): void {
    const count = this.clicks.count(performance.now(), x, y);
    if (count === 1) {
      document.getSelection()?.removeAllRanges();
      const l = this.linkAt(pageEl, x, y);
      if (l && !l.classList.contains("lit")) this.hooks.openLink(l.dataset.pwLink!);
      return;
    }
    const pos = this.posAt(x, y);
    const w = pos && this.known.get(pos.page);
    if (!pos || !w) return;
    const [first, last] = count === 2 ? [pos.k, pos.k] : lineOf(w, pos.k);
    this.select({ page: pos.page, k: first, at: 0 }, { page: pos.page, k: last, at: w.words[last][0].length });
  }

  /** The place among the words nearest a point of the screen: on the page under it, else the
   *  nearest page above or below whose words are laid over it. */
  private posAt(x: number, y: number): WordPos | null {
    let best: Page | null = null;
    let box: DOMRect | null = null;
    let bestD = Infinity;
    for (const p of this.pages) {
      if (!p.words) continue;
      const r = p.el.getBoundingClientRect();
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < bestD) {
        best = p;
        box = r;
        bestD = d;
      }
      if (!d) break;
    }
    if (!best || !box) return null;
    return this.posOnPage(best.n, (x - box.left) / box.width, (y - box.top) / box.height);
  }

  /** The place among page `n`'s words nearest a point of it, in its fractions; null while its words
   *  are not laid over it. */
  private posOnPage(n: number, fx: number, fy: number): WordPos | null {
    const p = this.pages[n - 1];
    const w = this.known.get(n);
    if (!p?.words || !w) return null;
    const at = nearestWord(w, fx, fy, p.w / p.h);
    return at ? { page: n, ...at } : null;
  }

  /** The browser's selection set from one place among the words to another. */
  private select(a: WordPos, b: WordPos): void {
    const at = (q: WordPos): [Node, number] | null => {
      const t = this.pages[q.page - 1]?.words?.children[q.k]?.firstChild;
      const word = this.known.get(q.page)?.words[q.k]?.[0];
      return t && word !== undefined ? [t, Math.min(q.at, word.length)] : null;
    };
    const x = at(a), y = at(b);
    if (x && y) document.getSelection()?.setBaseAndExtent(x[0], x[1], y[0], y[1]);
  }

  /** Where the selection there is starts, among the words; null where it is not on these pages. */
  private selectionStart(): WordPos | null {
    const s = document.getSelection();
    return s && !s.isCollapsed ? this.posOf(s.anchorNode, s.anchorOffset) : null;
  }

  /** A place of the browser's selection read as a place among the words; null outside them. */
  private posOf(node: Node | null, offset: number): WordPos | null {
    const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null);
    const layer = el?.closest<HTMLElement>(".pw-words");
    if (!el || !layer || !this.scroller.contains(layer)) return null;
    const n = Number(layer.parentElement?.dataset.n);
    const w = this.known.get(n);
    const kids = layer.children;
    if (!w || !kids.length) return null;
    let k: number, at: number;
    if (el === layer) {
      // between the spans: before the one at `offset`, or after the last
      k = Math.min(offset, kids.length - 1);
      at = offset >= kids.length ? Infinity : 0;
    } else {
      k = Array.prototype.indexOf.call(kids, el);
      at = node === el ? (offset > 0 ? Infinity : 0) : offset;
    }
    const word = w.words[k]?.[0];
    return word === undefined ? null : { page: n, k, at: Math.min(at, word.length) };
  }

  /** ⌘C, Ctrl+C, the context menu's Copy: what is selected on the pages, as its words read — a
   *  space between two words of a line, a line break between lines — rather than as the browser
   *  would read spans placed one by one. A selection elsewhere is the browser's. */
  private copied = (e: ClipboardEvent): void => {
    const s = document.getSelection();
    if (!s || s.isCollapsed || !e.clipboardData) return;
    const a = this.posOf(s.anchorNode, s.anchorOffset), b = this.posOf(s.focusNode, s.focusOffset);
    const text = a && b ? copyText((n) => this.known.get(n), a, b) : "";
    if (!text) return;
    e.clipboardData.setData("text/plain", text);
    e.preventDefault();
  };

  private selectionChanged = (): void => {
    if (!this.selWait) this.selWait = requestAnimationFrame(() => ((this.selWait = 0), this.drawSelection()));
  };

  /** What is selected on the pages, lit as a search's matches are: a box a line over the words
   *  selected, the first and the last cut where the selection cuts them (`selectedRects`). The
   *  browser's own drawing of it is hidden (web/style.css), since it lights each span on its own,
   *  of uneven heights and with seams where two meet. */
  private drawSelection(): void {
    for (const p of this.selOn) p.sel.textContent = "";
    this.selOn.clear();
    const s = document.getSelection();
    if (this.gone || !s || s.isCollapsed) return;
    const a = this.posOf(s.anchorNode, s.anchorOffset), b = this.posOf(s.focusNode, s.focusOffset);
    if (!a || !b) return;
    const [from, to] = notAfter(a, b) ? [a, b] : [b, a];
    for (let n = from.page; n <= to.page; n++) {
      const p = this.pages[n - 1];
      const w = this.known.get(n);
      if (!p || !w) continue;
      for (const r of selectedRects(w, n === from.page ? from : null, n === to.page ? to : null)) p.sel.append(boxAt(r, "pw-selbox"));
      this.selOn.add(p);
    }
  }

  /** The cursor and the label of the link under the pointer, on the page it is over (null: none). */
  private hoverLink(page: HTMLElement | null, x: number, y: number): void {
    const l = page ? this.linkAt(page, x, y) : null;
    const on = l ? page : null;
    if (this.overLink && this.overLink !== on) {
      this.overLink.classList.remove("on-link");
      this.overLink.removeAttribute("title");
    }
    this.overLink = on;
    if (!on || !l) return;
    on.classList.add("on-link");
    if (on.title !== l.title) on.title = l.title;
  }

  /** A page's words, asked of the server once; null where they cannot be read. */
  private wordsOf(n: number): Promise<PageWords | null> {
    let w = this.asked.get(n);
    if (!w) {
      w = this.hooks
        .words(n)
        .catch(() => null)
        .then((x) => {
          this.known.set(n, x);
          return x;
        });
      this.asked.set(n, w);
    }
    return w;
  }

  protected override async placeOfBox(page: number | undefined, r: Region): Promise<Partial<LinkPlace>> {
    if (!page) return {};
    const w = await this.wordsOf(page);
    const quote = w ? quoteInRegion(w.words, w.lines, r) : null;
    return quote ? { quote } : {};
  }

  setMarks(marks: PaperMark[]): void {
    this.marks = marks;
    for (const p of this.pages) this.drawMarks(p);
  }

  /** The links on a page, lit where they are, and its margin's markers. */
  private drawMarks(p: Page): void {
    p.marks.textContent = "";
    const here = this.marks.filter((m) => m.page === p.n);
    const tops = new Map<string, number>();
    for (const m of here) {
      // its region where it has one, else its quote's words where they are known
      const { rects, box } = placeOnPage(m, this.known.get(p.n));
      const kind = m.region ? `region${m.id ? "" : " clip"}` : "quote";
      for (const r of rects) {
        const d = boxAt(r, `pw-mark${m.lit ? " lit" : ""} ${kind}`);
        if (m.id) d.dataset.pwLink = m.id;
        d.title = m.label;
        p.marks.append(d);
      }
      tops.set(m.id, box?.[1] ?? 0.02);
    }
    this.drawMargin(p.margin, here, (m) => tops.get(m.id) ?? 0.02);
  }

  /** Go to a place: its page, scrolled so that its region is in sight — or its quote, once its
   *  page's words come. The page and the region never wait for the words, and words that cannot
   *  be read, or a quote not found in them, leave it there. */
  show(place: LinkPlace | null): void {
    if (!place) return;
    if (!this.pdf) {
      this.pending = place;
      return;
    }
    this.pending = null;
    const p = this.pages[(place.page ?? 1) - 1];
    if (!p) return;
    const turn = ++this.going;
    const go = (frac: number) => {
      this.scroller.scrollTop = Math.max(0, p.el.offsetTop + frac * p.el.offsetHeight - this.scroller.clientHeight * 0.25);
    };
    go(place.region ? place.region[1] : 0);
    if (place.quote && !place.region) {
      const q = place.quote;
      void this.wordsOf(p.n)
        .then((w) => {
          if (this.gone || turn !== this.going || !w) return;
          this.drawMarks(p);
          const box = placeOnPage({ quote: q }, w).box;
          if (box) go(box[1]);
        })
        .catch(() => {});
    }
  }

  // ---------------------------------------------------------------- search

  /** Find `q` in the file's words, by the server: how many matches (null: the text cannot be read),
   *  and whether there are more than shown; every match drawn as boxes, the first shown. */
  async search(q: string): Promise<{ n: number; more: boolean } | null> {
    this.hitList = [];
    this.hit = -1;
    this.drawHits();
    if (!this.pdf || q.replace(/\s+/g, " ").trim().length < 2) return { n: 0, more: false };
    const r = await this.hooks.search(q).catch(() => null);
    if (this.gone || !r) return null;
    try {
      this.hitList = r.hits.filter((h) => this.pages[h.page - 1]).map((h) => ({ page: h.page, boxes: lineRects(h.boxes) }));
    } catch {
      // matches of a shape this page does not expect: none drawn, and the search says it cannot read
      return null;
    }
    this.drawHits();
    if (this.hitList.length) this.step(1);
    return { n: this.hitList.length, more: r.more };
  }

  /** The next match (or the one before), shown. Which one of how many. */
  step(d: number): { at: number; of: number } {
    if (!this.hitList.length) return { at: 0, of: 0 };
    this.hit = (this.hit + d + this.hitList.length) % this.hitList.length;
    const h = this.hitList[this.hit];
    const p = this.pages[h.page - 1];
    const box = around(h.boxes);
    this.scroller.scrollTop = Math.max(0, p.el.offsetTop + (box ? box[1] * p.el.offsetHeight - this.scroller.clientHeight * 0.3 : -40));
    this.going++;
    this.drawHits();
    return { at: this.hit + 1, of: this.hitList.length };
  }

  /** Every match drawn as boxes over its page, the one shown lit. */
  private drawHits(): void {
    for (const p of this.pages) p.hits.textContent = "";
    this.hitList.forEach((h, k) => {
      const p = this.pages[h.page - 1];
      for (const b of h.boxes) p.hits.append(boxAt(b, `pw-hit${k === this.hit ? " on" : ""}`));
    });
  }

  destroy(): void {
    this.gone = true;
    this.watch?.disconnect();
    this.resize?.disconnect();
    document.removeEventListener("copy", this.copied);
    document.removeEventListener("selectionchange", this.selectionChanged);
    cancelAnimationFrame(this.selWait);
    for (const p of this.pages) this.forget(p);
    void this.task?.destroy();
    this.scroller.remove();
  }
}

/** An image of the library, zoomed and moved as the canvas is: the wheel and a drag move it, Ctrl
 *  and the wheel (a pinch) zoom it at the pointer; with the box tool armed, a drag draws a box. */
export class ImageView extends View {
  private stage: HTMLElement;
  private img: HTMLImageElement;
  private marksEl: HTMLElement;
  private margin: HTMLElement;
  private k = 1;
  private x = 0;
  private y = 0;
  private fitted = true;
  private resize: ResizeObserver | null = null;

  constructor(host: HTMLElement, hooks: PaperViewHooks) {
    super(host, hooks);
    this.scroller.classList.add("pw-image");
    this.stage = document.createElement("div");
    this.stage.className = "pw-stage";
    this.img = document.createElement("img");
    this.img.className = "pw-img";
    this.img.draggable = false;
    this.img.alt = "";
    this.marksEl = document.createElement("div");
    this.marksEl.className = "pw-marks";
    this.margin = document.createElement("div");
    this.margin.className = "pw-margin";
    this.stage.append(this.img, this.marksEl, this.margin);
    this.scroller.append(this.stage);
    // the wheel moves the image, as it moves a PDF's pages; with Ctrl (a pinch on a trackpad) it
    // zooms at the pointer
    this.scroller.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) return this.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
        this.fitted = false;
        this.x -= e.deltaX;
        this.y -= e.deltaY;
        this.place();
      },
      { passive: false },
    );
    // an image has no text: a drag moves it, by mouse, pen or touch, as a touch scrolls a PDF's
    // pages; with the box tool armed, a drag with mouse or pen draws a box, as on a PDF's page. A
    // click on a link's region opens it
    this.scroller.addEventListener("pointerdown", (e) => {
      const kind = pressKind({ armed: this.hooks.boxing(), image: true, pointer: e.pointerType, button: e.button, marker: !!(e.target as HTMLElement).closest(".pw-marker") });
      if (!kind) return;
      e.preventDefault();
      if (kind === "box") return this.dragBox(e, this.stage, undefined);
      const x0 = e.clientX, y0 = e.clientY, sx = this.x, sy = this.y;
      let moved = false;
      this.scroller.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientX - x0) < BOX_PX && Math.abs(ev.clientY - y0) < BOX_PX) return;
        moved = true;
        this.scroller.classList.add("panning");
        this.fitted = false;
        this.x = sx + ev.clientX - x0;
        this.y = sy + ev.clientY - y0;
        this.place();
      };
      const up = (ev: PointerEvent) => {
        this.scroller.removeEventListener("pointermove", move);
        this.scroller.removeEventListener("pointerup", up);
        this.scroller.removeEventListener("pointercancel", up);
        this.scroller.classList.remove("panning");
        if (moved || ev.type !== "pointerup") return;
        // a click: on a link drawn there, the link opens; elsewhere what was picked goes
        const l = this.linkAt(this.stage, ev.clientX, ev.clientY);
        if (l) return this.hooks.openLink(l.dataset.pwLink!);
        this.clearDrag();
        this.hooks.picked(null, null);
      };
      this.scroller.addEventListener("pointermove", move);
      this.scroller.addEventListener("pointerup", up);
      this.scroller.addEventListener("pointercancel", up);
    });
    this.scroller.addEventListener("click", (e) => {
      const m = (e.target as HTMLElement).closest<HTMLElement>("[data-pw-subject]");
      if (m) this.hooks.goSubject(m.dataset.pwSubject!);
    });
  }

  async open(url: string): Promise<void> {
    await new Promise<void>((ok, no) => {
      this.img.onload = () => ok();
      this.img.onerror = () => no(new Error("the image cannot be shown"));
      this.img.src = url;
    });
    this.resize = new ResizeObserver(() => {
      if (this.fitted) this.fit();
    });
    this.resize.observe(this.scroller);
    this.fit();
    this.hooks.paged(1, 1);
  }

  private fit(): void {
    const w = this.img.naturalWidth, h = this.img.naturalHeight;
    const W = this.scroller.clientWidth, H = this.scroller.clientHeight;
    if (!w || !h || !W || !H) return;
    this.k = Math.min((W - 2 * GAP) / w, (H - 2 * GAP) / h, 4);
    this.x = (W - w * this.k) / 2;
    this.y = (H - h * this.k) / 2;
    this.place();
  }

  private place(): void {
    const w = this.img.naturalWidth * this.k, h = this.img.naturalHeight * this.k;
    Object.assign(this.stage.style, { width: `${w}px`, height: `${h}px`, transform: `translate(${this.x}px, ${this.y}px)` });
  }

  private zoomAt(by: number, cx: number, cy: number): void {
    const r = this.scroller.getBoundingClientRect();
    const px = cx - r.left, py = cy - r.top;
    const k = fit(this.k * by, 0.05, 20);
    this.x = px - ((px - this.x) * k) / this.k;
    this.y = py - ((py - this.y) * k) / this.k;
    this.k = k;
    this.fitted = false;
    this.place();
  }

  zoom(by: number | "fit"): void {
    if (by === "fit") {
      this.fitted = true;
      return this.fit();
    }
    const r = this.scroller.getBoundingClientRect();
    this.zoomAt(by, r.left + r.width / 2, r.top + r.height / 2);
  }

  setMarks(marks: PaperMark[]): void {
    this.marks = marks;
    this.marksEl.textContent = "";
    for (const m of marks) {
      if (!m.region) continue;
      const d = boxAt(m.region, `pw-mark region${m.lit ? " lit" : ""}${m.id ? "" : " clip"}`);
      if (m.id) d.dataset.pwLink = m.id;
      d.title = m.label;
      this.marksEl.append(d);
    }
    this.drawMargin(this.margin, marks, (m) => m.region?.[1] ?? 0.02);
  }

  /** A region of the image, brought into sight: zoomed so that it fills most of the window. */
  show(place: LinkPlace | null): void {
    const r = place?.region;
    if (!r || !this.img.naturalWidth) return;
    const w = this.img.naturalWidth, h = this.img.naturalHeight;
    const W = this.scroller.clientWidth, H = this.scroller.clientHeight;
    this.k = fit(Math.min((W * 0.8) / ((r[2] - r[0]) * w), (H * 0.8) / ((r[3] - r[1]) * h)), 0.05, 8);
    this.x = W / 2 - ((r[0] + r[2]) / 2) * w * this.k;
    this.y = H / 2 - ((r[1] + r[3]) / 2) * h * this.k;
    this.fitted = false;
    this.place();
  }

  destroy(): void {
    this.resize?.disconnect();
    this.scroller.remove();
  }
}
