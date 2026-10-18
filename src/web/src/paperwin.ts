// The reference window (AttachmentSpec decisions 5, 7, 8, 9 and 11): a window of the page, like the
// source window (web/src/floatwin.ts moves, resizes, collapses and stacks it), that shows a file of
// the library — a PDF drawn by pdf.js, or an image (web/src/paperview.ts) — at a place, the link's
// region or quote lit. When it is paired with a source window the two stand side by side
// (web/src/paperdock.ts): the source on the left, this window on the right; a window the reader
// moves or resizes keeps its place, the other beside it, where the two can stand side by side.
//
// Its line under the title bar says what it shows: whose link it is (a declaration's own, or the
// innermost cluster's around it, decision 8), the other links offered beside, or that a declaration
// has none and the window keeps what it showed. A drag on a page selects its text, to copy, and
// makes nothing (the owner's decision of 2026-10-12). The box is a tool: the title bar's ▭ arms it
// for the next drag alone, which draws a box and disarms it; ▭ again, or Esc, disarms it without
// drawing. A box is a place to link to: "Link to …" the declaration or the cluster selected on the
// board, with a label to say what it is ("Theorem 3, p. 12"; by default the page and the first words
// inside the box, read from the server's words of the page). From a panel's "Link to a reference…"
// it links one subject: go to the place, then Link here, or Link this page. A past board's are
// refused, as the review is (ViewSpec decision 26). The margin of each page marks the subjects linked
// to it; a click goes there on the board, by the page's own way of going to a declaration, which
// never leaves the board (decision 27). Search reads the server's words too, its matches drawn as
// boxes over the pages.
//
// A box drawn on a PDF's page is also a clip (AttachmentSpec decision 12): Clip to a note makes a
// note of the project carrying it, its text the label written in the field (or the words inside the
// box, quoted in full); from a note's menu, Attach… opens a PDF here to attach to that note, whole or
// by a clip of it. A clip a note carries opens here at its page, its region lit.
//
// The box tool is the reader's own (web/src/surfaces.ts): those who follow them see neither it nor
// what they select.
//
// A file this server lacks (its record and links came from another server, through the review's
// logs) says so, and takes only bytes of its hash. An archived file still opens, saying it is.
//
// What it shows is shared with those who follow the reader (CollabSpec decision 4): the file, its
// page, the link it was opened on, whether it is collapsed (`state`, `mirror`).

import type { PaperWindow as PaperState } from "../../shared/collab.ts";
import { defaultLabel, fileOf, linkOf, linkOffer, linksInto, sizeWords, subjectWords } from "../../shared/library.ts";
import type { FileRecord, Link, LinkPlace, Region, Word } from "../../shared/library.ts";
import { clipNoteText } from "../../shared/sticky.ts";
import type { NoteCarry } from "../../shared/sticky.ts";
import type { ReviewChange, ReviewData } from "../../shared/review.ts";
import { FloatWindow } from "./floatwin.ts";
import type { Rect, Size } from "./floatwin.ts";
import { betweenPanels, MIN } from "./paperdock.ts";
import { escapeHtml } from "./highlight.ts";
import { ImageView, PdfView } from "./paperview.ts";
import type { Hit, PageWords, PaperMark } from "./paperview.ts";
import { BoxTool } from "./paperwords.ts";
import { composing } from "./ime.ts";
import { typing } from "./typing.ts";


export interface PaperHooks {
  review(): ReviewData;
  /** apply a change of the review at once, as an answer brought it */
  takeChange(c: ReviewChange): void;
  /** what is selected on the board, as a link's subject and in words; null for nothing */
  boardSubject(): { subject: string; words: string } | null;
  /** why a link cannot be made here (a past board, a snapshot), or null */
  cannotLink(): string | null;
  /** go to a subject on the board: a declaration (a visitor where the board does not hold it) or a
   *  cluster */
  goSubject(subject: string): void;
  /** a subject in a few words, as a margin's marker says it */
  short(subject: string): string;
  /** the request's headers: the reader's name */
  headers(): Record<string, string>;
  /** ask for the reader's name where there is none; whether there is one now */
  ensureName(): Promise<boolean>;
  /** what the window shows changed: the others are told */
  changed(): void;
  /** tell the reader something for a moment */
  say(text: string): void;
  /** where the window stands beside the source window it is paired with, on the right of the two or
   *  beside where the reader placed that one (web/src/paperdock.ts, pairPlaces), while that one is
   *  open; null otherwise */
  docked(vp: Size): Rect | null;
  /** the reader moved or resized the window: the source window paired with it stands beside it */
  placed(): void;
  /** why no note can be written here (a preview of a view, a snapshot), or null */
  cannotNote(): string | null;
  /** why no file can be opened here (a snapshot of the page carries the library's records, not its
   *  files), or null */
  noFiles?(): string | null;
  /** Clip to a note: a note of the project carrying the clip, with that text; whether it was made */
  clip(c: NoteCarry, text: string): Promise<boolean>;
  /** a file or a clip attached to note `note` (its menu's Attach…); whether it was */
  attach(note: string, c: NoteCarry): Promise<boolean>;
}

const ICON = {
  // the box tool, ▭: a rectangle drawn as the other icons are
  box: `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="2.5" y="4.5" width="11" height="7" rx="0.6"/></svg>`,
  find: `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 13.5 13.5"/></svg>`,
  minus: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 8h8"/></svg>`,
  plus: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 4v8M4 8h8"/></svg>`,
  fit: `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3"/></svg>`,
  collapse: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 8.5h8"/></svg>`,
};

/** Why the window shows what it does, as its line says it. */
interface Why {
  /** the link opened, and whose it is when it is another subject's (a cluster's for a declaration) */
  link?: Link;
  for?: string;
  /** the other links of the same subject, offered */
  others?: Link[];
  /** a passing word: a declaration with no link, the window keeping what it showed */
  note?: string;
}

export class PaperWin {
  readonly el: HTMLElement;
  private box: HTMLElement;
  private pill: HTMLElement;
  private win: FloatWindow;
  private hooks: PaperHooks;
  private view: PdfView | ImageView | null = null;
  private host: HTMLElement;
  private infoEl: HTMLElement;
  private findEl: HTMLElement;
  private pickEl: HTMLElement;
  /** the file on show, the link lit, the page in sight */
  file: FileRecord | null = null;
  lit: string | null = null;
  private page = 1;
  private pages = 0;
  private why: Why = {};
  /** linking one subject (a panel's Link to a reference…): where Link here links */
  private linking: string | null = null;
  /** attaching to one note (its menu's Attach…): the note, and its first words for the line */
  private attaching: { note: string; label: string } | null = null;
  /** the clip a note carries, lit on its page where the window was opened from it */
  private spot: { page?: number; region: Region } | null = null;
  /** what the reader picked in the paper: a place to link to */
  private picked: LinkPlace | null = null;
  private turn = 0;
  /** the box tool: armed by ▭ for the next drag alone (web/src/paperwords.ts) */
  private tool = new BoxTool((armed) => this.drawTool(armed));
  /** the source window it stands beside, and what tells it that window moved or changed size */
  private dockWatch: MutationObserver | null = null;
  private dockSize: ResizeObserver | null = null;
  private dockedEl: HTMLElement | null = null;
  open = false;

  constructor(layer: HTMLElement, hooks: PaperHooks) {
    this.hooks = hooks;
    const el = document.createElement("div");
    el.className = "pw-win";
    el.tabIndex = -1;
    el.setAttribute("role", "dialog");
    el.hidden = true;
    this.box = document.createElement("div");
    this.box.className = "pw-box";
    this.pill = document.createElement("div");
    this.pill.className = "pw-pill";
    el.append(this.box, this.pill);
    layer.append(el);
    this.el = el;
    this.box.innerHTML =
      `<div class="pw-head"><span class="pw-doc" aria-hidden="true">📄</span><span class="pw-title"></span><span class="pw-pageno"></span>` +
      `<span class="pw-acts">` +
      `<button class="icon" data-pw-box aria-pressed="false" title="Draw a box: the next drag on a page draws one, to link or clip what is in it (Esc cancels)" aria-label="Draw a box">${ICON.box}</button>` +
      `<button class="icon" data-pw-find title="Find in the paper (/ in the window)" aria-label="Find">${ICON.find}</button>` +
      `<button class="icon" data-pw-zoom="out" title="Zoom out" aria-label="Zoom out">${ICON.minus}</button>` +
      `<button class="icon" data-pw-zoom="fit" title="Fit to the window" aria-label="Fit">${ICON.fit}</button>` +
      `<button class="icon" data-pw-zoom="in" title="Zoom in" aria-label="Zoom in">${ICON.plus}</button>` +
      `<button class="icon" data-pw-collapse aria-label="Collapse" title="Collapse to one line (or double-click the title bar)">${ICON.collapse}</button>` +
      `<button class="icon" data-pw-close aria-label="Close" title="Close (Esc)">✕</button></span></div>` +
      `<div class="pw-find" hidden><input type="search" placeholder="Find in the paper" spellcheck="false" autocomplete="off" aria-label="Find in the paper"><span class="pw-found"></span>` +
      `<button class="icon" data-pw-step="-1" aria-label="Previous">↑</button><button class="icon" data-pw-step="1" aria-label="Next">↓</button></div>` +
      `<div class="pw-info"></div><div class="pw-host"></div><div class="pw-pick" hidden></div>`;
    this.host = this.box.querySelector(".pw-host")!;
    this.infoEl = this.box.querySelector(".pw-info")!;
    this.findEl = this.box.querySelector(".pw-find")!;
    this.pickEl = this.box.querySelector(".pw-pick")!;
    this.win = new FloatWindow(el, {
      min: MIN,
      handle: ".pw-head",
      collapser: "[data-pw-collapse]",
      opener: ".pw-pill-open",
      keeper: null,
      // beside the source window while paired, else between the panels, until the reader moves or
      // resizes it
      start: (vp) => this.hooks.docked(vp) ?? betweenPanels(vp),
      placed: () => this.hooks.placed(),
      live: () => this.open,
      collapsed: () => this.hooks.changed(),
    });
    el.addEventListener("click", (e) => this.clicked(e));
    el.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement).closest("input")) {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
          e.stopPropagation();
        }
        return;
      }
      if (e.key === "Escape") {
        e.stopPropagation();
        // what was picked goes first, then the window; with the box tool armed, Esc never comes
        // here: the document's listener below takes it
        if (this.picked) return this.unpick();
        this.close();
      } else if (e.key === "/") {
        e.preventDefault();
        this.toggleFind(true);
      }
    });
    // Esc disarms the box tool wherever the focus is — the reader may have pressed elsewhere since
    // arming it — before the page's Esc closes anything; typed into a field it is the field's
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape" || !this.tool.armed || e.isComposing || typing(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        this.tool.escape();
      },
      { capture: true },
    );
    const input = this.findEl.querySelector("input")!;
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || composing(e)) return;
      e.preventDefault();
      if (input.dataset.done === input.value) return this.step(e.shiftKey ? -1 : 1);
      input.dataset.done = input.value;
      void this.find(input.value);
    });
  }

  // ---------------------------------------------------------------- opening

  /** Open a file of the library: at `place`, the link `lit` lit (its place, unless one is given), or
   *  the region `spot` lit (a clip a note carries). */
  async show(sha: string, opts: { link?: string | null; place?: LinkPlace | null; why?: Why; spot?: { page?: number; region: Region } | null } = {}): Promise<void> {
    const d = this.hooks.review();
    const f = fileOf(d, sha);
    if (!f) return this.hooks.say("The library has no such file.");
    const l = opts.link ? linkOf(d, opts.link) : null;
    const place = opts.place ?? (l ? { page: l.page, region: l.region, quote: l.quote } : null);
    this.lit = l?.id ?? null;
    this.spot = opts.spot ?? null;
    this.why = opts.why ?? (l ? { link: l } : {});
    const was = this.open;
    this.open = true;
    this.el.hidden = false;
    if (!was) this.win.layout();
    if (this.win.collapsed) this.win.setCollapsed(false);
    this.win.front();
    if (this.file?.sha !== sha || !this.view) await this.load(f);
    else this.file = f;
    this.drawHead();
    this.drawInfo();
    this.drawMarks();
    if (place) this.view?.show(place);
    this.hooks.changed();
  }

  /** Load a file into the window: drawn by pdf.js, or shown as an image; or what is said where it
   *  cannot be. */
  private async load(f: FileRecord): Promise<void> {
    const turn = ++this.turn;
    this.view?.destroy();
    this.view = null;
    this.file = f;
    this.page = 1;
    this.pages = f.pages ?? 0;
    this.unpick();
    const none = this.hooks.noFiles?.();
    if (none) {
      this.host.innerHTML = `<div class="pw-missing"><p><b>${escapeHtml(f.title)}</b></p><p>${escapeHtml(none)}</p></div>`;
      return;
    }
    this.host.innerHTML = `<div class="pw-wait">Opening ${escapeHtml(f.title)}…</div>`;
    const url = `/api/library/file?sha=${f.sha}`;
    // a file whose record came through the logs from another server: this one may lack its bytes
    const info = (await fetch(`/api/library/info?sha=${f.sha}`)
      .then((r) => r.json())
      .catch(() => null)) as { file?: { have?: boolean } } | null;
    if (turn !== this.turn) return;
    if (info?.file?.have === false) return this.missing(f);
    this.host.textContent = "";
    const hooks = {
      picked: (place: LinkPlace | null, at: DOMRect | null) => this.pick(place, at),
      // a page's text is the server's words of it, never pdf.js's (the owner's decision of
      // 2026-10-11): they are what a quote is found by, a box's words, and what search reads
      words: (page: number) => readWords(f.sha, page),
      search: (q: string) => searchWords(f.sha, q),
      boxing: () => this.tool.armed,
      boxed: () => this.tool.drawn(),
      goSubject: (s: string) => this.hooks.goSubject(s),
      openLink: (id: string) => {
        const l = linkOf(this.hooks.review(), id);
        if (l) void this.show(l.file, { link: id, why: { link: l } });
      },
      paged: (page: number, pages: number) => {
        this.page = page;
        this.pages = pages;
        this.drawPageNo();
        this.hooks.changed();
      },
      marginLabel: (s: string) => this.hooks.short(s),
    };
    const v = f.type === "pdf" ? new PdfView(this.host, hooks) : new ImageView(this.host, hooks);
    this.view = v;
    try {
      await v.open(url);
    } catch (e) {
      if (turn !== this.turn) return;
      this.host.innerHTML = `<div class="pw-wait">${escapeHtml(f.title)} cannot be shown: ${escapeHtml(e instanceof Error ? e.message : String(e))}</div>`;
    }
  }

  /** The file is not on this server: say so, and take only a file of its hash. */
  private missing(f: FileRecord): void {
    this.host.innerHTML =
      `<div class="pw-missing"><p><b>This server does not have the file of ${escapeHtml(f.title)}.</b> Its record and its links came with the review; its bytes are kept by the server that added it.</p>` +
      `<p>Add it here: only a file of exactly that content is taken (SHA-256 <code>${f.sha.slice(0, 16)}…</code>, ${sizeWords(f.size)}).</p>` +
      `<label class="rv-btn primary pw-add"><input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,application/pdf,image/png,image/jpeg,image/webp,image/gif" data-pw-fill hidden>Choose the file…</label><span class="pw-fill-why"></span></div>`;
    this.host.querySelector<HTMLInputElement>("[data-pw-fill]")!.addEventListener("change", (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) void this.fill(f, file);
    });
  }

  private async fill(f: FileRecord, file: File): Promise<void> {
    if (!(await this.hooks.ensureName())) return;
    const why = this.host.querySelector<HTMLElement>(".pw-fill-why");
    if (why) why.textContent = "Adding…";
    const r = await fetch(`/api/library/upload?name=${encodeURIComponent(file.name)}&sha=${f.sha}`, { method: "POST", headers: { ...this.hooks.headers(), "content-type": "application/octet-stream" }, body: file }).catch(() => null);
    const b = (await r?.json().catch(() => null)) as { error?: string; hint?: string } | null;
    if (!r?.ok) {
      if (why) why.textContent = b?.error ? `${b.error} ${b.hint ?? ""}` : "The server could not be reached.";
      return;
    }
    this.view = null;
    await this.load(f);
    this.drawMarks();
  }

  /** Close the window. */
  close(): void {
    if (!this.open) return;
    this.open = false;
    this.turn++;
    this.view?.destroy();
    this.view = null;
    this.file = null;
    this.lit = null;
    this.linking = null;
    this.attaching = null;
    this.spot = null;
    this.unpick();
    this.tool.reset();
    this.el.hidden = true;
    this.win.reset();
    this.dock(null);
    this.hooks.changed();
  }

  get collapsed(): boolean {
    return this.win.collapsed;
  }

  /** Whether the reader moved or resized it since the page last placed it: then it stays where they
   *  put it, where the pairing can keep it (web/src/paperdock.ts, pairKeeps). */
  get byHand(): boolean {
    return this.win.byHand;
  }

  /** Where it is on the screen. */
  rect(): Rect {
    return { ...this.win.rect };
  }

  /** Where the reader put it is forgotten (the pairing opened it): it goes where its rule puts it,
   *  beside the source window it is paired with. */
  unmove(): void {
    this.win.unmove();
  }

  /** What the window shows, as presence carries it to those who follow (CollabSpec decision 4). */
  state(): PaperState | null {
    if (!this.open || !this.file) return null;
    return { file: this.file.sha, ...(this.page ? { page: this.page } : {}), ...(this.lit ? { link: this.lit } : {}), ...(this.win.collapsed ? { collapsed: true } : {}) };
  }

  /** Following someone: this window as theirs is — the same file, at their page, their link lit;
   *  closed where theirs is. */
  mirror(s: PaperState | null | undefined): void {
    if (!s) return this.close();
    const same = this.file?.sha === s.file && this.lit === (s.link ?? null);
    if (!same || !this.open) void this.show(s.file, { link: s.link ?? null, place: s.link ? null : { page: s.page } });
    else if (s.page && s.page !== this.page) this.view?.show({ page: s.page });
    if (!!s.collapsed !== this.win.collapsed) this.win.setCollapsed(!!s.collapsed);
  }

  /** The review changed: the title, the links and the line drawn again. */
  refresh(): void {
    if (!this.open || !this.file) return;
    const f = fileOf(this.hooks.review(), this.file.sha);
    if (f) this.file = f;
    if (this.lit && !linkOf(this.hooks.review(), this.lit)) this.lit = null;
    this.drawHead();
    this.drawInfo();
    this.drawMarks();
  }

  // ---------------------------------------------------------------- docking

  /** Stand beside the source window `el` (null: none), laid out again as that one is moved, placed,
   *  collapsed, or changes size — a window fitted to its code grows and shrinks with the code where
   *  it stands, its style unchanged, so its style alone does not say so. While the reader drags it,
   *  this window stays where it is, and goes beside it once they let go: not sliding and redrawing
   *  its pages at every step of the drag. While it waits unseen for its code (web/src/sourcewin.ts,
   *  awaitCode), this window waits unseen with it, and the two appear together where they stay. */
  dock(el: HTMLElement | null): void {
    if (el === this.dockedEl) return this.win.layout();
    this.dockWatch?.disconnect();
    this.dockSize?.disconnect();
    this.dockWatch = this.dockSize = null;
    this.dockedEl = el;
    this.el.classList.remove("waiting");
    if (el) {
      const follow = () => {
        const waits = el.matches(".opening");
        this.el.classList.toggle("waiting", waits);
        if (!waits && !el.matches(".moving, .sizing")) this.win.layout();
      };
      this.dockWatch = new MutationObserver(follow);
      this.dockWatch.observe(el, { attributes: true, attributeFilter: ["style", "class"] });
      if (typeof ResizeObserver !== "undefined") {
        this.dockSize = new ResizeObserver(follow);
        this.dockSize.observe(el);
      }
      follow();
    } else if (this.open) this.win.layout();
  }

  // ---------------------------------------------------------------- linking

  /** A panel's "Link to a reference…": the window links `subject` (shown in its line) until it does or
   *  the reader cancels. */
  startLinking(subject: string): void {
    this.linking = subject;
    this.attaching = null;
    this.drawInfo();
    this.drawPick();
  }

  /** A note's "Attach…" with a PDF chosen: the window attaches to that note (its first words in the
   *  line) the whole paper, or a clip of it, until it does or the reader cancels. */
  startAttaching(note: string, label: string): void {
    this.attaching = { note, label };
    this.linking = null;
    this.drawInfo();
    this.drawPick();
  }

  /** Why the window shows what it does: its line, drawn again. */
  setWhy(why: Why): void {
    this.why = why;
    this.drawInfo();
  }

  private pick(place: LinkPlace | null, at: DOMRect | null): void {
    this.picked = place;
    this.drawPick(at);
  }

  private unpick(): void {
    this.picked = null;
    this.view?.clearDrag();
    this.pickEl.hidden = true;
  }

  /** What to do with what was picked: Link to the selected declaration or cluster (or, linking one
   *  subject, Link here), under a label to say what it is; and, for a box of a PDF's page, Clip to a
   *  note (or, attaching to a note, Clip to the note). */
  private drawPick(at?: DOMRect | null): void {
    const p = this.picked;
    const f = this.file;
    if (!p || !f) {
      this.pickEl.hidden = true;
      return;
    }
    const e = escapeHtml;
    const clip = this.clipOf(p);
    if (this.attaching) {
      // attaching to one note: a clip of the page; a box on an image is nothing to clip
      this.pickEl.innerHTML = clip
        ? `<button class="rv-btn primary" data-pw-attach-clip title="Attach this region of page ${clip.page} to the note">Clip to the note</button>`
        : `<span class="pw-pick-no">Draw a box on a page of a paper to clip it, or attach the whole paper.</span>`;
    } else {
      const offer = linkOffer({ cannot: this.hooks.cannotLink(), archived: !!f.archived, linking: this.linking, board: this.hooks.boardSubject()?.subject ?? null });
      const label = defaultLabel(p, f.type);
      // a clip makes a note, which a past board takes though it takes no link (ViewSpec decision 26)
      const clipNo = clip ? (f.archived ? "This file is archived: restore it from the Library to clip it." : this.hooks.cannotNote()) : null;
      const clipping = !!clip && !clipNo && !this.linking;
      const field =
        "subject" in offer || clipping
          ? `<input class="pw-label" value="${e(label)}" maxlength="200" aria-label="The label" title="The link's label, as the panel lists it, or the note's text: e.g. Theorem 3, p. 12">`
          : "";
      const link =
        "refused" in offer
          ? clipping
            ? ""
            : `<span class="pw-pick-no">${e(offer.refused)}</span>`
          : "subject" in offer
            ? `<button class="rv-btn primary" data-pw-link-to="${e(offer.subject)}" title="Link ${e(offer.subject)} to this place">${offer.here ? "Link here" : `Link to ${e(this.hooks.short(offer.subject))}`}</button>`
            : clipping
              ? ""
              : `<span class="pw-pick-no">Select a declaration or a cluster on the board to link it here.</span>`;
      const clipBtn = clipping
        ? `<button class="rv-btn${"subject" in offer ? "" : " primary"}" data-pw-clip title="A note of the project carrying this region of page ${clip!.page}, in the cluster of what is selected on the board (else on the ring), its text the label">Clip to a note</button>`
        : clip && clipNo && !this.linking && !("subject" in offer)
          ? `<span class="pw-pick-no">${e(clipNo)}</span>`
          : "";
      this.pickEl.innerHTML = field + link + clipBtn;
    }
    this.pickEl.hidden = false;
    // beside what was picked, inside the window
    const box = this.box.getBoundingClientRect();
    const r = at ?? this.pickEl.getBoundingClientRect();
    const w = this.pickEl.offsetWidth || 300;
    const x = Math.max(8, Math.min(box.width - w - 8, r.left - box.left));
    const y = r.bottom - box.top + 6 + 32 > box.height ? Math.max(40, r.top - box.top - 38) : r.bottom - box.top + 6;
    Object.assign(this.pickEl.style, { left: `${x}px`, top: `${y}px` });
  }

  /** What was picked as a clip a note can carry: a region of a PDF's page; null for anything else
   *  (an image is carried whole). */
  private clipOf(p: LinkPlace): (NoteCarry & { page: number; region: Region }) | null {
    return this.file?.type === "pdf" && p.page && p.region ? { file: this.file.sha, page: p.page, region: p.region } : null;
  }

  /** Clip to a note: the note's text is what the field says where the reader wrote in it; left as it
   *  came, the words inside the box in full, quoted, where it holds any, else the label (the page). */
  private async clipToNote(): Promise<void> {
    const p = this.picked;
    const f = this.file;
    const c = p && this.clipOf(p);
    if (!p || !f || !c) return;
    const field = this.pickEl.querySelector<HTMLInputElement>(".pw-label")?.value ?? "";
    const text = clipNoteText(field, defaultLabel(p, f.type), p.quote?.text ?? null, c.page);
    if (!(await this.hooks.clip(c, text))) return;
    this.unpick();
  }

  /** Attach to the note being attached to: the clip picked, or the whole paper. */
  private async attachTo(c: NoteCarry): Promise<void> {
    const a = this.attaching;
    if (!a) return;
    if (!(await this.hooks.attach(a.note, c))) return;
    this.attaching = null;
    this.unpick();
    this.drawInfo();
  }

  /** Make the link: the subject, this file, the place picked (or, Link this page, the page alone). */
  private async link(subject: string, place: LinkPlace, label: string | null): Promise<void> {
    const f = this.file;
    if (!f) return;
    const no = this.hooks.cannotLink();
    if (no) return this.hooks.say(no);
    if (!(await this.hooks.ensureName())) return;
    const r = await fetch("/api/library/link", { method: "POST", headers: this.hooks.headers(), body: JSON.stringify({ subject, file: f.sha, ...place, ...(label ? { label } : {}) }) }).catch(() => null);
    const b = (await r?.json().catch(() => null)) as { error?: string; link?: Link; change?: ReviewChange } | null;
    if (!r?.ok || !b?.link) return this.hooks.say(b?.error ?? "The server could not be reached.");
    if (b.change) this.hooks.takeChange(b.change);
    this.linking = null;
    this.unpick();
    this.lit = b.link.id;
    this.why = { link: b.link };
    this.drawInfo();
    this.drawMarks();
    this.hooks.say(`Linked ${this.hooks.short(subject)} to ${b.link.label}.`);
    this.hooks.changed();
  }

  // ---------------------------------------------------------------- drawing

  /** The box tool's button pressed while it is armed, and the cursor a crosshair over the pages. */
  private drawTool(armed: boolean): void {
    const b = this.box.querySelector<HTMLElement>("[data-pw-box]")!;
    b.setAttribute("aria-pressed", String(armed));
    b.classList.toggle("on", armed);
    this.el.classList.toggle("boxing", armed);
  }

  private drawHead(): void {
    const f = this.file;
    if (!f) return;
    const t = this.box.querySelector<HTMLElement>(".pw-title")!;
    t.textContent = f.title;
    t.title = `${f.title}${f.url ? ` — ${f.url}` : ""}`;
    this.el.setAttribute("aria-label", `Reference: ${f.title}`);
    this.drawPageNo();
    // an image has no text to find
    this.box.querySelector<HTMLElement>("[data-pw-find]")!.hidden = f.type !== "pdf";
    if (f.type !== "pdf") this.findEl.hidden = true;
    this.pill.innerHTML =
      `<button class="pw-pill-open" type="button" title="Open ${escapeHtml(f.title)} again"><span aria-hidden="true">📄</span><span class="pw-pill-name">${escapeHtml(f.title)}</span></button>` +
      `<button class="icon" data-pw-close aria-label="Close" title="Close">✕</button>`;
  }

  private drawPageNo(): void {
    const n = this.box.querySelector<HTMLElement>(".pw-pageno")!;
    n.textContent = this.file?.type === "pdf" && this.pages ? `p. ${this.page} / ${this.pages}` : this.file ? this.file.type.toUpperCase() : "";
  }

  /** The line under the title bar: linking, whose link this is and the others offered, a passing
   *  word, an archived file. */
  private drawInfo(): void {
    const f = this.file;
    const parts: string[] = [];
    const chip = (l: Link) =>
      `<button class="pw-chip${l.id === this.lit ? " on" : ""}" data-pw-open="${escapeHtml(l.id)}" title="${escapeHtml(l.label)} — ${escapeHtml(fileOf(this.hooks.review(), l.file)?.title ?? "")}">${escapeHtml(l.label)}</button>`;
    if (this.attaching && f)
      parts.push(
        `<span class="pw-linking">Attaching to the note <b>${escapeHtml(this.attaching.label)}</b>: press ▭ and drag a box around what to clip, then <i>Clip to the note</i>.</span>` +
          `<button class="rv-btn" data-pw-attach-whole>Attach the whole paper</button><button class="rv-btn" data-pw-cancel>Cancel</button>`,
      );
    if (this.linking)
      parts.push(
        `<span class="pw-linking">Linking <b>${escapeHtml(subjectWords(this.linking))}</b>: go to the place, press ▭ and drag a box around it, then <i>Link here</i>.</span>` +
          (f?.type === "pdf" ? `<button class="rv-btn" data-pw-link-page>Link this page</button>` : `<button class="rv-btn" data-pw-link-page>Link the image</button>`) +
          `<button class="rv-btn" data-pw-cancel>Cancel</button>`,
      );
    const w = this.why;
    if (w.note) parts.push(`<span class="pw-note">${escapeHtml(w.note)}</span>`);
    if (w.link) {
      const of = w.link.subject;
      const whose = w.for && w.for !== of ? `${escapeHtml(this.hooks.short(w.for))} has no link of its own: this is <b>${escapeHtml(subjectWords(of))}</b>'s` : `Linked to <b>${escapeHtml(this.hooks.short(of))}</b>`;
      parts.push(`<span class="pw-whose">${whose} · ${escapeHtml(w.link.label)}${w.link.agent ? ` <span class="pw-by" title="Linked by ${escapeHtml(w.link.by)}, an AI agent">🤖</span>` : ""}</span>`);
    }
    const others = (w.others ?? []).filter((l) => l.id !== this.lit);
    if (others.length) parts.push(`<span class="pw-others"><span class="muted">Also:</span> ${others.map(chip).join("")}</span>`);
    if (f?.archived) parts.push(`<span class="pw-note">This file is archived (by ${escapeHtml(f.archived.by)}): restore it from the Library to link to it.</span>`);
    this.infoEl.innerHTML = parts.join("");
    this.infoEl.hidden = !parts.length;
  }

  /** The links into the file drawn on it, the one opened lit. */
  private drawMarks(): void {
    if (!this.view || !this.file) return;
    const marks: PaperMark[] = linksInto(this.hooks.review(), this.file.sha).map((l) => ({ id: l.id, subject: l.subject, label: l.label, page: l.page, region: l.region, quote: l.quote, lit: l.id === this.lit }));
    // the clip a note carries, where the window was opened from it: lit, and no link
    if (this.spot) marks.push({ id: "", subject: "", label: "The clip a note carries", page: this.spot.page, region: this.spot.region, lit: true });
    this.view.setMarks(marks);
  }

  // ---------------------------------------------------------------- search

  private toggleFind(on: boolean): void {
    this.findEl.hidden = !on;
    if (on) this.findEl.querySelector("input")!.focus();
  }

  /** Search the paper's words, by the server: the matches drawn as boxes, the first shown. */
  private async find(q: string): Promise<void> {
    const out = this.findEl.querySelector<HTMLElement>(".pw-found")!;
    if (!(this.view instanceof PdfView)) return;
    out.textContent = "Finding…";
    const r = await this.view.search(q);
    this.more = !!r?.more;
    out.textContent = !r ? "Its text cannot be read" : r.n ? `1 / ${r.n}${r.more ? "+" : ""}` : "Not found";
  }

  /** whether the last search had more matches than the server answers */
  private more = false;

  private step(d: number): void {
    if (!(this.view instanceof PdfView)) return;
    const r = this.view.step(d);
    this.findEl.querySelector<HTMLElement>(".pw-found")!.textContent = r.of ? `${r.at} / ${r.of}${this.more ? "+" : ""}` : "Not found";
  }

  // ---------------------------------------------------------------- clicks

  private clicked(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (t.closest("[data-pw-close]")) return this.close();
    if (t.closest("[data-pw-box]")) return this.tool.press();
    if (t.closest("[data-pw-find]")) return this.toggleFind(this.findEl.hidden);
    const step = t.closest<HTMLElement>("[data-pw-step]");
    if (step) return this.step(Number(step.dataset.pwStep));
    const z = t.closest<HTMLElement>("[data-pw-zoom]");
    if (z && this.view) return this.view.zoom(z.dataset.pwZoom === "fit" ? "fit" : z.dataset.pwZoom === "in" ? 1.2 : 1 / 1.2);
    const open = t.closest<HTMLElement>("[data-pw-open]");
    if (open) {
      const l = linkOf(this.hooks.review(), open.dataset.pwOpen!);
      if (l) void this.show(l.file, { link: l.id, why: { ...this.why, link: l } });
      return;
    }
    const to = t.closest<HTMLElement>("[data-pw-link-to]");
    if (to && this.picked) {
      const label = this.pickEl.querySelector<HTMLInputElement>(".pw-label")?.value.trim() || null;
      return void this.link(to.dataset.pwLinkTo!, this.picked, label);
    }
    if (t.closest("[data-pw-link-page]") && this.linking && this.file) return void this.link(this.linking, this.file.type === "pdf" ? { page: this.page } : {}, null);
    if (t.closest("[data-pw-clip]") && this.picked) return void this.clipToNote();
    if (t.closest("[data-pw-attach-clip]") && this.picked) {
      const c = this.clipOf(this.picked);
      return void (c && this.attachTo(c));
    }
    if (t.closest("[data-pw-attach-whole]") && this.file) return void this.attachTo({ file: this.file.sha });
    if (t.closest("[data-pw-cancel]")) {
      this.linking = null;
      this.attaching = null;
      this.unpick();
      return this.drawInfo();
    }
  }
}

/** A page's words, as the server reads them (`GET /api/library/text`); null where they cannot be
 *  read — the reference window then shows and links the page as it is, by regions alone. */
async function readWords(sha: string, page: number): Promise<PageWords | null> {
  const r = await fetch(`/api/library/text?sha=${sha}&page=${page}`).catch(() => null);
  const b = (await r?.json().catch(() => null)) as { words?: unknown; lines?: unknown } | null;
  return r?.ok && b && Array.isArray(b.words) && Array.isArray(b.lines) ? { words: b.words as Word[], lines: b.lines as number[] } : null;
}

/** Every match of `q` in a PDF's words, by the server (`GET /api/library/search`), at most the 500
 *  it answers; null where it cannot search the file. */
async function searchWords(sha: string, q: string): Promise<{ hits: Hit[]; more: boolean } | null> {
  const r = await fetch(`/api/library/search?sha=${sha}&q=${encodeURIComponent(q)}&limit=500`).catch(() => null);
  const b = (await r?.json().catch(() => null)) as { matches?: { page: number; boxes: Region[] }[]; more?: boolean } | null;
  if (!r?.ok || !b || !Array.isArray(b.matches)) return null;
  return { hits: b.matches.map((m) => ({ page: m.page, boxes: m.boxes })), more: !!b.more };
}
