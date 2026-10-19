// A source window (ReviewSpec, "The source window", decided 2026-10-09): a declaration's source in
// a floating window over the page (web/src/floatwin.ts), with the declaration's review below the
// code under one scrollbar. It opens as the modal window did: in the middle of the screen, as large
// as the code needs within bounds, and fitted again to each declaration it shows until the reader
// moves or resizes it; from then on it keeps their place and size until it closes. The code wraps
// to the window's width, each line's continuations hanging under its own indentation, so that the
// reader only ever scrolls down. The page keeps one that follows the selection and those the reader
// pinned (web/src/sources.ts): the pin in the title bar keeps a window on its declaration. The
// following window has the page's back and forward at its top left; a pinned one stays on one
// declaration, so it has none. Each collapses to a pill with its declaration's name.
//
// It appears at the size its code gives it, once (AttachmentSpec decision 8, the owner's of
// 2026-10-12, after the source and reference windows changed size just after they appeared): a new
// window waits unseen while its declaration's code is read, and one stepping to another declaration
// keeps showing the one before, inert, until the new code is drawn; only a reading longer than
// READ_WAIT shows that it reads. What waits for the code to be drawn — the pairing with the
// reference window — waits on `drawn`.
//
// What it shows is the text the graph was read from. When the file has changed since it was
// compiled, the compiled place means nothing any more: the declaration is found again by name in
// the present text, and the window says that this is not what Lean checked.
//
// On a board of a past build (HistorySpec decision 23, 2026-10-10) it shows the text that build was
// compiled from, at the place the snapshot recorded, with that build's line numbers and the names in
// it resolved on the past graph (web/src/pastsource.ts); or says that the text is not kept. Lean
// knows only the latest build, so there it is not asked: a name shows its statement and doc then.
//
// Hovering the code shows what Lean says is there, as VS Code does (server/hover.ts): the type of
// a name, a binder, a term, with its documentation, in a card the pointer can move onto; a name in
// a card opens a card of its own (hovercards.ts). Where there is no Lean to ask (a snapshot), names
// of declarations show their statement and doc from the graph.
//
// Every name of a declaration in the code links to it. The page resolves names itself first, from
// the namespaces and `open`s in the file (scope.ts); then Lean is asked what each name in the
// excerpt means, and its answer wins — that is what links dot notation (`o.elim`) and anything
// else only the elaborator can tell.
//
// Above the code, muted, is the context it is written in (TCBSpec.md, decision 4; shared/context.ts):
// the namespaces, opens, variables, options in force there, as Lean, folded when long; the
// `variable`s it seems to use are marked. An opinion records it with the text. Below the code of a
// unit, the declarations Lean generated from its command (ViewNode.also), each with what Lean's
// `#print` says of it when asked.
//
// Lines of the code are quoted into the window's comment (ReviewSpec, "Comments", decided
// 2026-10-09): text selected in the code shows a small "Quote in comment" button at the right edge,
// under the selection's last line, which puts the lines it touches, whole — source lines, not the
// rows they wrap to — into the comment box below, under a header giving the file and the lines
// (shared/comment.ts, quoteCode). Hover cards stand aside while text in the code is selected, so
// that nothing covers the button. A code quote's header, clicked in a comment, opens the source
// there: the lines scrolled to and flashed (showLines).

import type { FileStatus } from "../../shared/build.ts";
import type { DataSource } from "./data.ts";
import { locateLines, quoteCode, selectedLines } from "../../shared/comment.ts";
import { contextLines, exactContext, readContext, usedVariables } from "../../shared/context.ts";
import type { FileContext } from "../../shared/context.ts";
import { excerptOf } from "../../shared/excerpt.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import { cascadeRect, EDGE, FloatWindow } from "./floatwin.ts";
import type { Rect, Size } from "./floatwin.ts";
import { escapeHtml, highlightLean, highlightLines, KEYWORDS, renderDoc, renderHover } from "./highlight.ts";
import { genNote, interpretsHtml } from "./panel.ts";
import type { PastGraph } from "./past.ts";
import { pastNote, pastText } from "./pastsource.ts";
import type { RefAnswer } from "./highlight.ts";
import { HoverCards } from "./hovercards.ts";
import { FLASH_MS } from "./reviewbox.ts";
import type { ReviewBox } from "./reviewbox.ts";
import { editorAnchor } from "./editor.ts";
import { namespacesOf, resolver, scopeAt } from "./scope.ts";
import { asideRect, MIN, openBounds, openRect } from "./sources.ts";
import { kindDot } from "./axiomring.ts";
import { reducedMotion } from "./theme.ts";
import type { SourcePane } from "./sources.ts";

export interface SourceHooks {
  /** go to a declaration named in the source, by its name in the window's graph */
  go(name: string): void;
  /** the build status of a module's file; none on a past build */
  fileOf(module: string): FileStatus | undefined;
  /** the Lake hash of the text a module was compiled from, as the graph has it */
  compiledOf(module: string): string | null | undefined;
  /** the reader closed the window (its ✕), or pinned it (its pin) */
  close(w: SourceWindow): void;
  pin(w: SourceWindow): void;
  /** the window was collapsed to its pill or opened again: what the others are told changed */
  collapsed(w: SourceWindow): void;
  /** a step back or forward in the page's history (the bar's ← and →), and whether there is one */
  back(): void;
  forward(): void;
  steps(): { back: boolean; forward: boolean };
  /** the link that opens declaration `i` of graph `g` in the reader's editor: at `at` (line and
   *  column from 1) in the file as it is now, else at its compiled place; null when there is none */
  editorLink(g: Graph, i: number, at?: { line: number; col: number }): string | null;
  /** following a branch on GitHub (DeploySpec decision 13): the link to lines `from` to `to` (from 1)
   *  of `file` at `commit`; null where the server follows no branch on GitHub */
  githubLink?(file: string, commit: string, from: number, to: number): string | null;
  /** following a branch, the commit whose build the graph of now was read from */
  builtCommit?(): string | null;
  /** the past graph `g` is (a board of a past build), with that build in words; null for the graph
   *  of now */
  pastOf(g: Graph): { past: PastGraph; when: string } | null;
  /** where the pinned windows are: the following window steps aside from one it would lie on */
  pinned(): Rect[];
  /** where a pinned window's top may be: under the page's bars (web/src/paperdock.ts, pairTop) */
  top(): number;
  /** while the reference window stands beside window `w`, paired with it (AttachmentSpec decision
   *  8): the room `w` has — how wide it may be, and how tall it is — and where it goes at the size
   *  its code gives it, on the left of the two or beside where the reader put the reference window;
   *  null where `w` is not paired */
  docked?(w: SourceWindow): { room(vp: Size): Size; at(size: Size, vp: Size): Rect } | null;
  /** tell the reader something for a moment */
  say(text: string): void;
}

/** What every source window of the page shares: what Lean said the names of an excerpt mean (by
 *  module, text hash and first line: offset of the name in the excerpt → what it links to), and
 *  what its `#print` said of a generated declaration (as HTML). */
export interface SourceMemory {
  learned: Map<string, Map<number, RefAnswer>>;
  printed: Map<string, string>;
}

export const sourceMemory = (): SourceMemory => ({ learned: new Map(), printed: new Map() });

const BACK = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>`;
const FORWARD = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>`;
/** a push pin: outlined on the following window (pin it), filled on a pinned one */
const PIN = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M6 2.5h4l-.6 4 2.1 2.2v.8H4.5v-.8L6.6 6.5 6 2.5zM8 9.5v4"/></svg>`;
const COLLAPSE = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 8.5h8"/></svg>`;
/** how long a declaration's code is waited for before the window shows that it reads: past it, a
 *  new window appears with "Reading the source…", one that showed another declaration says so over
 *  it, keeping its size */
const READ_WAIT = 1000;

export class SourceWindow implements SourcePane {
  g: Graph;
  /** the window, in the windows' layer (#windows); what is drawn in it, and the pill it collapses to */
  readonly el: HTMLElement;
  private frameEl: HTMLElement;
  private pillEl: HTMLElement;
  private win: FloatWindow;
  private data: DataSource;
  private box: ReviewBox;
  private hooks: SourceHooks;
  /** the declaration on show, and its name; -1 before the first */
  current = -1;
  /** on a past graph: no Lean is asked, which knows only the latest build; and which build's text
   *  is on show, for what the window says of it */
  private still = false;
  private era: "now" | "then" = "now";
  name = "";
  /** pinned: it stays on its declaration, and its place is its own */
  pinned = false;
  /** pinned as it opened, for a followed reader's window: how many steps aside from the middle of
   *  the screen it stands while it is fitted to its code (asideRect); 0 for any other */
  private aside = 0;
  /** bumped on every render, so a slow fetch for an earlier one is dropped */
  private turn = 0;
  /** the code on show: its module, its first line in the file, the hash of the text */
  private shown: { module: string; start: number; hash: string } | null = null;
  /** the hover cards, and the word of the code the first one is for */
  private cards: HoverCards;
  private tipAt = "";
  private hoverTurn = 0;
  private hoverWait: ReturnType<typeof setTimeout> | null = null;
  /** where the pointer last was over the code, to ask again when scrolling stops under it */
  private pointer: { pre: HTMLElement; x: number; y: number } | null = null;
  private scrollEnd: ReturnType<typeof setTimeout> | null = null;
  /** whether a long context is shown whole: the reader's choice, kept as the window follows */
  private ctxOpen = false;
  /** why the pairing opened no reference beside it, as the line under its title bar says it
   *  (AttachmentSpec decision 8), kept as it is drawn again; null: nothing to say */
  private pairWhy: string | null = null;
  /** the generated declarations whose `#print` the reader opened, kept while the window is drawn
   *  again */
  private printOpen = new Set<string>();
  /** what Lean said, shared by the page's source windows */
  private memory: SourceMemory;
  /** how a name in the code on show resolves, as the page reads the file */
  private resolve: ((w: string) => string | null) | null = null;
  /** the code on show, to quote from: its file, the line it starts at there (from 0), its lines */
  private code: { file: string; start: number; lines: string[] } | null = null;
  /** the lines of the code the selection touches (indices into `code.lines`), and the button beside
   *  it that quotes them */
  private picked: { first: number; last: number } | null = null;
  private quoteBtn: HTMLButtonElement | null = null;
  private selWait = 0;
  private onSelection = () => {
    if (!this.selWait) this.selWait = requestAnimationFrame(() => ((this.selWait = 0), this.selectionChanged()));
  };
  /** source lines to show (showLines): until when, and since when they flash where they were
   *  found (0: not shown yet). The code may be drawn again meanwhile — the window following the
   *  selection, Lean's answer about its names — and they flash on where they were. */
  private linesWanted: { from: number; to: number; quoted: string[] | null; until: number; since: number } | null = null;
  /** whether it has drawn a declaration's frame yet: until then it waits unseen */
  private drawnOnce = false;
  /** the render whose code is being read, 0 for none; past READ_WAIT, the window says that it
   *  reads; and what waits for the frame to be drawn */
  private reading = 0;
  private readWait: ReturnType<typeof setTimeout> | null = null;
  private waiting: (() => void)[] = [];

  /** A window in `layer`, following the selection until it is pinned. */
  constructor(layer: HTMLElement, g: Graph, data: DataSource, box: ReviewBox, hooks: SourceHooks, memory: SourceMemory) {
    this.g = g;
    this.data = data;
    this.box = box;
    this.hooks = hooks;
    this.memory = memory;
    const el = document.createElement("div");
    el.className = "sw-win";
    el.tabIndex = -1;
    el.setAttribute("role", "dialog");
    this.frameEl = document.createElement("div");
    this.frameEl.className = "sw-box";
    this.pillEl = document.createElement("div");
    this.pillEl.className = "sw-pill";
    el.append(this.frameEl, this.pillEl);
    layer.append(el);
    this.el = el;
    // as large as its code needs, in the middle of the screen, until the reader moves or resizes
    // it; nothing of where it was is kept for the next one
    this.win = new FloatWindow(el, {
      min: MIN,
      handle: ".sw-head",
      collapser: "[data-sw-collapse]",
      opener: ".sw-pill-open",
      keeper: null,
      fit: {
        // beside the reference window it is paired with, it leaves that window its room, and is as
        // tall as it, so that their tops and bottoms line up
        bounds: (vp) => {
          // a pinned window opened for a followed reader's stands under the page's bars
          const b = openBounds(vp, this.aside ? this.hooks.top() : EDGE);
          const d = this.hooks.docked?.(this);
          if (!d) return b;
          const r = d.room(vp);
          return { max: { w: Math.min(b.max.w, r.w), h: r.h }, min: { w: Math.min(b.min.w, r.w), h: r.h } };
        },
        at: (size, vp) => {
          const d = this.hooks.docked?.(this);
          return d ? d.at(size, vp) : this.aside ? asideRect(size, vp, this.aside, this.hooks.top()) : openRect(size, vp, this.hooks.pinned());
        },
      },
      live: () => true,
      collapsed: () => this.hooks.collapsed(this),
      // a pinned window the page placed keeps under the page's bars as the page is resized
      top: () => this.hooks.top(),
    });
    // the quote button keeps the selection it quotes: a press on it neither moves the caret nor
    // the focus
    const keep = (e: Event) => (e.target as HTMLElement).closest?.("[data-sw-quote]") && e.preventDefault();
    el.addEventListener("pointerdown", keep);
    el.addEventListener("mousedown", keep);
    document.addEventListener("selectionchange", this.onSelection);
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-sw-quote]")) return this.quotePicked();
      if (t.closest("[data-sw-close]")) return this.hooks.close(this);
      if (t.closest("[data-sw-pin]")) return this.hooks.pin(this);
      if (t.closest("[data-sw-back]")) return this.hooks.back();
      if (t.closest("[data-sw-fwd]")) return this.hooks.forward();
      if (t.closest(".sw-pill, [data-sw-collapse]")) return;
      const ref = t.closest<HTMLElement>("[data-ref]");
      if (ref) {
        if (this.g.byName.has(ref.dataset.ref!)) this.hooks.go(ref.dataset.ref!);
        return;
      }
      // the whole context, or its first lines again
      const ctx = t.closest<HTMLElement>("[data-sw-ctx]");
      if (ctx) {
        const box = ctx.closest<HTMLElement>(".sw-ctx");
        if (box) {
          this.ctxOpen = box.classList.toggle("open");
          ctx.textContent = this.ctxOpen ? "fewer" : ctx.dataset.swCtx!;
        }
        return;
      }
      // what Lean made of a declaration the command generated, asked when wanted
      const gen = t.closest<HTMLElement>("[data-sw-gen]");
      if (gen) {
        const name = gen.dataset.swGen!;
        const out = gen.parentElement?.querySelector<HTMLElement>("[data-sw-print]");
        if (out && this.current >= 0) {
          out.hidden = !out.hidden;
          if (out.hidden) this.printOpen.delete(name);
          else this.printOpen.add(name);
          if (!out.hidden && !this.memory.printed.has(name)) void this.printInto(this.turn, this.current, name, out);
        }
        return;
      }
      // the review's buttons act on this window's declaration, whatever is selected
      if (this.current >= 0) this.box.click(t, this.current, el);
    });
    el.addEventListener("input", (e) => {
      if (this.current >= 0) this.box.input(e.target as HTMLElement, this.current);
    });
    this.cards = new HoverCards({
      // the graph's card at once; Lean's, with the signature and doc it gives the name, when it comes
      card: (name) => ({ html: this.fromGraph(name), more: this.describe(name) }),
      go: (name) => {
        if (this.g.byName.has(name)) this.hooks.go(name);
      },
    });
    el.addEventListener("mousemove", (e) => {
      const pre = (e.target as HTMLElement).closest?.("pre.src") as HTMLElement | null;
      this.pointer = pre ? { pre, x: e.clientX, y: e.clientY } : null;
      if (this.hoverWait) clearTimeout(this.hoverWait);
      // selecting, or something selected in the code: its quote button, not a card, is beside it
      if (e.buttons || this.picked) return;
      // off the code: the cards close unless the pointer is on its way onto one
      if (!pre || !this.shown) return this.cards.leave();
      const { clientX: x, clientY: y } = e;
      this.hoverWait = setTimeout(() => this.pointAt(pre, x, y), 120);
    });
    el.addEventListener("mouseleave", () => {
      this.pointer = null;
      if (this.hoverWait) clearTimeout(this.hoverWait);
      this.cards.leave();
    });
    // a scroll moves the code from under the tooltip; once it stops, what is under the pointer now
    el.addEventListener(
      "scroll",
      () => {
        this.hideTip();
        if (this.scrollEnd) clearTimeout(this.scrollEnd);
        this.scrollEnd = setTimeout(() => {
          const p = this.pointer;
          if (p && this.shown && p.pre.isConnected) this.pointAt(p.pre, p.x, p.y);
        }, 200);
      },
      true,
    );
  }

  // ---------------------------------------------------------------- the window (SourcePane)

  get decl(): number {
    return this.current;
  }

  get collapsed(): boolean {
    return this.win.collapsed;
  }

  /** Show declaration `i`: another one, or the same drawn again. */
  show(i: number): void {
    const first = this.current < 0;
    const fresh = i !== this.current;
    this.current = i;
    this.name = this.g.nodes[i].name;
    void this.render(fresh);
    if (first) this.win.layout();
  }

  /** Laid out again where it is kept or fitted: a reference window paired beside it, or gone,
   *  changes the room it has. */
  relayout(): void {
    if (this.current >= 0) this.win.layout();
  }

  /** Whether the reader moved or resized it since the page last placed it: paired, their choice is
   *  kept where the reference window can stand beside it (AttachmentSpec decision 8). */
  get byHand(): boolean {
    return this.win.byHand;
  }

  /** Placed by the pairing (AttachmentSpec decision 8): a pinned window at `at`, its place its own
   *  as a pinned window's is; the following one fitted to its code by its rule again, which puts it
   *  beside the reference window; where the reader put it before is forgotten. `at` null: the
   *  pairing let go of a pinned window it had placed, which steps aside from there, as one pinned
   *  does. */
  pairAt(at: Rect | null): void {
    if (this.current < 0) return;
    if (!this.pinned) return this.win.unmove();
    const vp = { w: document.documentElement.clientWidth || innerWidth, h: document.documentElement.clientHeight || innerHeight };
    this.win.ownPlace(at ?? cascadeRect(this.rect(), [], vp, MIN, this.hooks.top()));
  }

  /** Why the pairing opened no reference beside it (AttachmentSpec decision 8): a line under its
   *  title bar; null takes it away. */
  unpaired(why: string | null): void {
    this.pairWhy = why;
    const html = this.pairHtml();
    const at = this.frameEl.querySelector<HTMLElement>(".sw-pair");
    if (at && html) at.outerHTML = html;
    else if (at) at.remove();
    else if (html) this.frameEl.querySelector(".sw-head")?.insertAdjacentHTML("afterend", html);
  }

  private pairHtml(): string {
    const p = this.pairWhy;
    return p ? `<div class="sw-pair" role="status"><span>${escapeHtml(p)}</span></div>` : "";
  }

  /** Its review drawn again, the rest as it is; a comment being written keeps its place. While the
   *  code of another declaration is read, the frame is still the one before's: the new frame draws
   *  the review. */
  redrawReview(): void {
    const r = this.el.querySelector<HTMLElement>(".sw-review");
    if (!r || this.current < 0 || this.reading) return;
    const a = document.activeElement;
    const typing = a instanceof HTMLTextAreaElement && r.contains(a) ? { from: a.selectionStart, to: a.selectionEnd } : null;
    r.innerHTML = this.box.html(this.current);
    // a box may have come or gone: the quote button with it
    this.selectionChanged();
    if (typing) {
      const box = r.querySelector<HTMLTextAreaElement>("[data-rv-comment]");
      box?.focus();
      box?.setSelectionRange(typing.from, typing.to);
    }
    this.box.reveal(this.el);
  }

  /** Pinned at `at`: it stays on its declaration, where the reader puts it, as large as they make
   *  it. */
  pin(at: Rect): void {
    this.pinned = true;
    this.el.classList.add("pinned");
    this.win.ownPlace(at);
    void this.render(false);
  }

  /** Pinned as it opens, for a followed reader's pinned window: fitted to its code `step` steps
   *  aside from the middle of the screen, until the reader moves or resizes it. Before its first
   *  declaration, it is drawn when that is shown. */
  pinAside(step: number): void {
    this.pinned = true;
    this.aside = step;
    this.el.classList.add("pinned");
    if (this.current < 0) return;
    this.win.layout();
    void this.render(false);
  }

  collapse(on: boolean): void {
    this.win.collapse(on);
    if (on) this.unpick();
  }

  front(): void {
    this.win.front();
  }

  /** Put it where it goes in the viewport as it is now: what it avoids may have moved. */
  layout(): void {
    this.win.layout();
  }

  rect(): Rect {
    return { ...this.win.rect };
  }

  holds(t: unknown): boolean {
    return t instanceof Node && this.el.contains(t);
  }

  /** Once the frame of the declaration it is on is drawn — at once where it is: what waits for the
   *  window to stand at the size its code gives it (the pairing, web/src/paperlinks.ts). */
  drawn(): Promise<void> {
    return this.reading ? new Promise((ok) => this.waiting.push(ok)) : Promise.resolve();
  }

  /** The code of the declaration of render `turn` is read: a new window waits unseen, drawn by
   *  `placeholder` meanwhile, and one that showed another declaration keeps showing it, inert, so
   *  that the window — and the reference window beside it — appears at the size the code gives it,
   *  once. A reading longer than READ_WAIT is said: the placeholder comes into sight, or a line over
   *  the frame before, which keeps its size. */
  private awaitCode(turn: number, placeholder: () => void): void {
    this.reading = turn;
    if (this.drawnOnce) {
      this.frameEl.inert = true;
      this.el.setAttribute("aria-busy", "true");
    } else {
      placeholder();
      this.el.classList.add("opening");
    }
    if (this.readWait) clearTimeout(this.readWait);
    this.readWait = setTimeout(() => {
      if (this.reading !== turn) return;
      if (this.el.classList.contains("opening")) this.el.classList.remove("opening");
      else this.el.classList.add("slow");
    }, READ_WAIT);
  }

  /** A declaration's frame is drawn: the window is in sight and live, and what waited for it goes
   *  on, in this same task, so that nothing is painted between. */
  private drew(): void {
    this.reading = 0;
    this.drawnOnce = true;
    if (this.readWait) clearTimeout(this.readWait);
    this.readWait = null;
    this.el.classList.remove("opening", "slow");
    this.el.removeAttribute("aria-busy");
    this.frameEl.inert = false;
    for (const ok of this.waiting.splice(0)) ok();
  }

  /** The window goes: its cards, its place in the layer, what it waits for. */
  remove(): void {
    this.turn++;
    if (this.readWait) clearTimeout(this.readWait);
    for (const ok of this.waiting.splice(0)) ok();
    this.hideTip();
    document.removeEventListener("selectionchange", this.onSelection);
    if (this.selWait) cancelAnimationFrame(this.selWait);
    this.unpick();
    if (this.scrollEnd) clearTimeout(this.scrollEnd);
    this.pointer = null;
    this.shown = null;
    this.cards.dispose();
    this.win.dispose();
    // the keys go back to the page
    if (this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.el.remove();
  }

  /** Whether the page's history has a step back and one forward: the following window's buttons. */
  setNav(back: boolean, forward: boolean): void {
    const b = this.el.querySelector<HTMLButtonElement>("[data-sw-back]");
    const f = this.el.querySelector<HTMLButtonElement>("[data-sw-fwd]");
    if (b) b.disabled = !back;
    if (f) f.disabled = !forward;
  }

  // ---------------------------------------------------------------- quoting the code

  /** The selection changed, or what it is in: where it touches the code on show and the window has
   *  a comment box, the lines it touches are picked, with the button that quotes them under the
   *  last; elsewhere, nothing is. Hover cards close as text is picked. */
  private selectionChanged(): void {
    const pre = this.el.querySelector<HTMLElement>("pre.src");
    const s = document.getSelection();
    const range = s && !s.isCollapsed && s.rangeCount ? s.getRangeAt(0) : null;
    const c = this.code;
    if (!pre || !c || !range || this.collapsed || !this.el.querySelector("[data-rv-comment]") || !range.intersectsNode(pre)) return this.unpick();
    // where it starts or ends outside the code, from the code's start or to its end
    const text = c.lines.join("\n");
    const from = pre.contains(range.startContainer) ? offsetIn(pre, range.startContainer, range.startOffset) : 0;
    const to = pre.contains(range.endContainer) ? offsetIn(pre, range.endContainer, range.endOffset) : text.length;
    const picked = selectedLines(text, from, to);
    const body = pre.closest<HTMLElement>(".sw-body");
    const last = picked && pre.querySelectorAll<HTMLElement>(".ln")[picked.last];
    if (!picked || !body || !last) return this.unpick();
    if (!this.picked) this.hideTip();
    this.picked = picked;
    let b = this.quoteBtn;
    if (!b || !body.contains(b)) {
      b?.remove();
      b = document.createElement("button");
      b.type = "button";
      b.className = "sw-quote";
      b.dataset.swQuote = "";
      body.append(b);
      this.quoteBtn = b;
    }
    const n = picked.last - picked.first + 1;
    b.textContent = "❝ Quote in comment";
    b.title = `Quote ${n === 1 ? "this line" : `these ${n} lines`} in your comment on ${this.name}, with where they are`;
    b.style.top = `${last.getBoundingClientRect().bottom - body.getBoundingClientRect().top + 3}px`;
  }

  /** Nothing picked: the quote button goes. */
  private unpick(): void {
    this.picked = null;
    this.quoteBtn?.remove();
    this.quoteBtn = null;
  }

  /** The lines picked, whole, quoted into this window's comment: a pinned window's is its own
   *  declaration's, as everything in its review is. Refused, the reader is told why. */
  private quotePicked(): void {
    const c = this.code;
    const p = this.picked;
    if (!c || !p || this.current < 0) return;
    // a past build is not reviewed: what is quoted goes into a comment on the latest build's text
    if (this.still) return this.hooks.say("A past build is not reviewed: lines are quoted into comments on the latest build.");
    const why = this.box.insert(this.el, this.current, quoteCode({ file: c.file, name: this.name, start: c.start, lines: c.lines, first: p.first, last: p.last }));
    if (why) return this.hooks.say(why);
    document.getSelection()?.removeAllRanges();
    this.unpick();
  }

  /** Lines `from`–`to` of the file (from 1), quoted in a comment whose header was clicked: scrolled
   *  to and flashed once the code is drawn, found by `quoted` (the code the quote holds) where the
   *  file changed above them since. */
  showLines(from: number, to: number, quoted: string[] | null): void {
    this.linesWanted = { from, to, quoted, until: Date.now() + 5000, since: 0 };
    if (this.code) this.flashLines();
  }

  /** The lines wanted, flashed in the code as drawn now: scrolled to the first time, and flashed on
   *  from where the flash was when the code is drawn again. */
  private flashLines(): void {
    const w = this.linesWanted;
    const c = this.code;
    const pre = this.el.querySelector<HTMLElement>("pre.src");
    if (!w || !c || !pre) return;
    const now = Date.now();
    if (now > (w.since ? w.since + FLASH_MS : w.until)) {
      this.linesWanted = null;
      return;
    }
    const span = locateLines(c.lines, c.start, w.from, w.to, w.quoted);
    if (!span) {
      this.linesWanted = null;
      return this.hooks.say(`Line${w.to > w.from ? `s ${w.from}–${w.to} are` : ` ${w.from} is`} not in the text of ${this.name} ${this.era === "then" ? "at this build" : "now"}.`);
    }
    const lns = pre.querySelectorAll<HTMLElement>(".ln");
    for (let k = span[0]; k <= span[1]; k++) {
      const l = lns[k];
      if (!l) continue;
      l.style.animationDelay = w.since ? `${w.since - now}ms` : "";
      l.classList.add("ln-flash");
    }
    if (!w.since) lns[span[0]]?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    w.since ||= now;
  }

  // ---------------------------------------------------------------- what Lean says

  private hideTip(): void {
    if (this.hoverWait) clearTimeout(this.hoverWait);
    this.hoverWait = null;
    this.hoverTurn++;
    this.tipAt = "";
    this.cards.hide();
  }

  private showTip(html: string, at: DOMRect, subject: string | null = null): void {
    this.cards.show(html, at, subject);
  }

  /** What Lean says about a declaration by name, as a card: asked where the module on show is
   *  imported, so everything the code on show can name is there. Null without Lean. */
  private async describe(name: string): Promise<string | null> {
    const s = this.shown;
    if (!s || this.still) return null;
    for (let k = 0; k < 20; k++) {
      const res = await this.data.describe(s.module, name);
      if (!res || res.error || res.stale) return null;
      if (!res.pending) return res.contents ? renderHover(res.contents, (w) => (this.g.byName.has(w) ? w : null)) : null;
      // Lean is still loading what the module imports
      await new Promise((ok) => setTimeout(ok, 800));
    }
    return null;
  }

  /** The character of `pre` under (x, y): its line and UTF-16 column in the code, and the box of
   *  the word it is in (one part of a dotted name: `o` and `elim` in `o.elim` are different
   *  things); null over nothing (past the end of a line, between lines, in the indentation a
   *  wrapped line hangs from). Lines are counted by the line breaks in the text, which the code
   *  keeps as it wraps (highlightLines): a line wrapped on the screen is one line here. */
  private positionAt(pre: HTMLElement, x: number, y: number): { line: number; ch: number; word: string; box: DOMRect } | null {
    const d = document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null; caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null };
    let node: Node | null = null, off = 0;
    const r = d.caretRangeFromPoint?.(x, y);
    if (r) [node, off] = [r.startContainer, r.startOffset];
    else {
      const c = d.caretPositionFromPoint?.(x, y);
      if (c) [node, off] = [c.offsetNode, c.offset];
    }
    if (!node || node.nodeType !== Node.TEXT_NODE || !pre.contains(node)) return null;
    const texts: Text[] = [];
    const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) texts.push(t as Text);
    let abs = 0;
    for (const t of texts) {
      if (t === node) break;
      abs += t.data.length;
    }
    abs += off;
    const text = texts.map((t) => t.data).join("");
    // the caret may sit just after the character the pointer is on
    const box = (k: number) => {
      if (k < 0 || k >= text.length || text[k] === "\n") return null;
      let acc = 0;
      for (const t of texts) {
        if (k < acc + t.data.length) {
          const range = document.createRange();
          range.setStart(t, k - acc);
          range.setEnd(t, k - acc + 1);
          return { rect: range.getBoundingClientRect(), node: t.parentNode };
        }
        acc += t.data.length;
      }
      return null;
    };
    const inside = (k: number) => {
      const b = box(k);
      return b && x >= b.rect.left && x <= b.rect.right && y >= b.rect.top && y <= b.rect.bottom ? b : null;
    };
    let hit = inside(abs);
    if (!hit && (hit = inside(abs - 1))) abs--;
    if (!hit) return null;
    const before = text.lastIndexOf("\n", abs - 1);
    const line = text.slice(0, abs).split("\n").length - 1;
    // the word: letters, digits, subscripts, ' ! ? _ around the character
    const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}_'!?₀-₉ₐ-ₜ]/u.test(c);
    let from = abs, to = abs + 1;
    if (isWord(text[abs])) {
      while (isWord(text[from - 1])) from--;
      while (isWord(text[to])) to++;
    }
    const range = this.rangeIn(texts, from, to);
    return { line, ch: abs - (before + 1), word: `${line}:${from - (before + 1)}`, box: range ? range.getBoundingClientRect() : hit.rect };
  }

  /** A range over characters `from`–`to` of the text nodes `texts`. */
  private rangeIn(texts: Text[], from: number, to: number): Range | null {
    const r = document.createRange();
    let acc = 0, started = false;
    for (const t of texts) {
      const len = t.data.length;
      if (!started && from < acc + len) {
        r.setStart(t, from - acc);
        started = true;
      }
      if (started && to <= acc + len) {
        r.setEnd(t, to - acc);
        return r;
      }
      acc += len;
    }
    return null;
  }

  private pointAt(pre: HTMLElement, x: number, y: number): void {
    const at = this.positionAt(pre, x, y);
    // nothing there, or a comment — over a doc comment Lean would describe the `docComment`
    // parser, not the declaration: the cards close unless the pointer is on its way onto one
    if (!at || document.elementFromPoint(x, y)?.closest(".tk-doc, .tk-comment")) return this.cards.leave();
    if (at.word === this.tipAt && this.cards.open) return;
    this.tipAt = at.word;
    const node = document.elementFromPoint(x, y);
    const ref = node?.closest?.("[data-ref]")?.getAttribute("data-ref") ?? null;
    void this.ask(at.line, at.ch, at.box, ref);
  }

  /** A declaration's statement and doc, from the graph: what a name shows without Lean, and the
   *  card a name in a card opens. Names in it link on. */
  private fromGraph(name: string | null): string | null {
    const i = name !== null ? this.g.byName.get(name) : undefined;
    if (i === undefined) return null;
    const g = this.g;
    const v = g.nodes[i];
    const own = resolver(g, v.name, null);
    const isRef = (w: string) => (w === v.name ? w : own(w));
    return (
      `<div class="hc-where"><span class="dot ${kindDot(v.kind, g.isExt(i))}"></span>${escapeHtml(v.kind)} · ${escapeHtml(v.module)}</div>` +
      `<pre class="code">${highlightLean(v.type ? `${v.name} : ${v.type}` : v.name, isRef)}</pre>` +
      (v.doc ? `<hr>${renderDoc(v.doc)}` : "")
    );
  }

  private async ask(line: number, ch: number, box: DOMRect, ref: string | null): Promise<void> {
    const s = this.shown;
    if (!s) return;
    // no Lean on a past graph: what the build knew of a name, its statement and doc then
    if (this.still) {
      const graph = this.fromGraph(ref);
      return graph ? this.showTip(graph, box) : this.cards.leave();
    }
    const turn = ++this.hoverTurn;
    const res = await this.data.hover(s.module, s.start + line, ch, s.hash);
    if (turn !== this.hoverTurn) return;
    const graph = this.fromGraph(ref);
    if (res === null) return graph ? this.showTip(graph, box) : this.cards.leave();
    if (res.stale) {
      this.hideTip();
      return void this.render(false);
    }
    if (res.pending) {
      this.showTip(`<div class="sw-tip-wait">Lean is checking this file: line ${res.pending.line + 1} of ${res.pending.of}…</div>${graph ?? ""}`, box);
      // ask again while the pointer stays
      setTimeout(() => {
        if (turn === this.hoverTurn) void this.ask(line, ch, box, ref);
      }, 900);
      return;
    }
    if (res.error) return this.showTip(`${graph ?? ""}<div class="sw-tip-err">Lean could not be asked: ${escapeHtml(res.error)}</div>`, box);
    if (!res.contents) return graph ? this.showTip(graph, box) : this.cards.leave();
    // Lean writes the declaration under the pointer by its full name, and the names in its type as
    // the code there would: resolved in the same scope
    const self = this.current >= 0 ? this.g.nodes[this.current].name : "";
    const resolve = this.resolve;
    // what the card is about: the declaration Lean names first, when it names one
    const head = /^```[^\n]*\n(\S+)/.exec(res.contents)?.[1]?.replace(/\.\{.*$/, "") ?? null;
    const subject = head && this.g.byName.has(head) ? head : null;
    this.showTip(renderHover(res.contents, (w) => (w === self ? w : resolve ? resolve(w) : this.g.byName.has(w) ? w : null)), box, subject);
  }

  private async render(fresh: boolean): Promise<void> {
    const i = this.current;
    if (i < 0) return;
    const turn = ++this.turn;
    this.hideTip();
    this.shown = null;
    this.code = null;
    this.unpick();
    const g = this.g;
    const v = g.nodes[i];
    const parts = v.name.split(".");
    const ext = g.isExt(i);
    const kind = ext ? "external" : v.kind;
    // a past graph's declaration: its text then (HistorySpec decision 23); a past graph holds that
    // build's declarations alone
    const past = this.hooks.pastOf(g);
    const then = past;
    this.still = !!past;
    this.era = then ? "then" : "now";
    // one scrollbar for the source and its review (the owner's request, 2026-10-08), and no other:
    // long lines wrap (2026-10-09)
    const scroll = this.el.querySelector<HTMLElement>(".sw-scroll");
    const keep = !fresh && scroll ? scroll.scrollTop : null;
    const typed = document.activeElement;
    // the comment box or whom one speaks for (ReviewSpec decision 8), being typed into
    const hadFocus =
      (typed instanceof HTMLTextAreaElement || typed instanceof HTMLInputElement) && this.el.contains(typed) && typed.matches("[data-rv-comment], [data-rv-for]")
        ? { sel: typed.matches("[data-rv-for]") ? "[data-rv-for]" : "[data-rv-comment]", from: typed.selectionStart, to: typed.selectionEnd }
        : null;
    const short = escapeHtml(v.display ?? parts[parts.length - 1]);
    const pinned = this.pinned;
    // the page's history, read when drawn, not now: it moves on while the source is fetched. A
    // pinned window stays on one declaration: it has no history, and its pin is a mark, not a button
    const steps = () => this.hooks.steps();
    const nav = () =>
      `<span class="nav"><button data-sw-back title="Back (Alt ←)" aria-label="Back"${steps().back ? "" : " disabled"}>${BACK}</button>` +
      `<button data-sw-fwd title="Forward (Alt →)" aria-label="Forward"${steps().forward ? "" : " disabled"}>${FORWARD}</button></span>`;
    const pin = pinned
      ? `<span class="sw-pinned" role="img" aria-label="Pinned" title="Pinned: it stays on ${escapeHtml(v.name)}, whatever is selected">${PIN}</span>`
      : `<button class="icon sw-pin" data-sw-pin aria-label="Pin" title="Pin: keep this window on ${escapeHtml(v.name)}; the next source you open (Space) opens in a new window beside it">${PIN}</button>`;
    // the editor opens the file as it is now: at the compiled place, unless the window found the
    // declaration somewhere else in a file that changed since; GitHub, the build's own text at its
    // commit, where the text shown is that commit's
    let remote: { href: string; commit: string } | null = null;
    const head = (where: string, editor: string | null) =>
      `<div class="sw-head">${pinned ? "" : nav()}<span class="dot ${kindDot(v.kind, ext)}"></span><span class="sw-name" title="${escapeHtml(v.name)}">${short}</span>` +
      `<span class="sw-ns">${escapeHtml(parts.slice(0, -1).join("."))}</span><span class="sw-loc">${where}</span>` +
      (editor ? editorAnchor(editor) : "") +
      (remote ? githubAnchor(remote.href, remote.commit) : "") +
      `<span class="sw-acts">${pin}<button class="icon" data-sw-collapse aria-label="Collapse" title="Collapse to one line (or double-click the title bar)">${COLLAPSE}</button>` +
      `<button class="icon sw-close" data-sw-close aria-label="Close" title="${pinned ? "Close (Esc)" : "Close (Esc, or Space)"}">✕</button></span></div>`;
    // `final`: the declaration's own frame, not what stands for it while its code is read
    const frame = (where: string, notes: string, body: string, editor = this.still ? null : this.hooks.editorLink(g, i), final = true) => {
      this.el.setAttribute("aria-label", `Source of ${v.name}${pinned ? ", pinned" : ""}`);
      this.frameEl.innerHTML =
        `${head(where, editor)}${this.pairHtml()}${notes}` +
        `<div class="sw-scroll"><div class="sw-body">${body}</div><div class="sw-review">${this.box.html(i)}</div></div>`;
      // collapsed, a pill with the declaration's name; a click opens the window again
      this.pillEl.innerHTML =
        `<button class="sw-pill-open" type="button" title="Open the source of ${escapeHtml(v.name)} again"><span class="dot ${kindDot(v.kind, ext)}"></span>` +
        `<span class="sw-pill-name">${short}</span>${pinned ? `<span class="sw-pinned" aria-label="Pinned">${PIN}</span>` : ""}</button>` +
        `<button class="icon sw-close" data-sw-close aria-label="Close" title="Close">✕</button>`;
      if (final) this.drew();
    };
    if (ext || !v.range) {
      frame(escapeHtml(v.module), "", `<div class="sw-none">${ext ? "A declaration from outside the project: its source is not served here." : "No source position was recorded for it."}</div>`);
      this.box.reveal(this.el);
      return;
    }
    if (fresh) this.awaitCode(turn, () => frame(escapeHtml(v.module), "", `<div class="sw-none">Reading the source…</div>`, undefined, false));
    /** the window drawn: where the reader was in it, and what a click in a comment asked for */
    const settle = () => {
      const scrolled = this.el.querySelector<HTMLElement>(".sw-scroll");
      if (scrolled && keep !== null) scrolled.scrollTop = keep;
      if (hadFocus) {
        const box = this.el.querySelector<HTMLInputElement | HTMLTextAreaElement>(hadFocus.sel);
        box?.focus();
        if (hadFocus.from !== null && hadFocus.to !== null) box?.setSelectionRange(hadFocus.from, hadFocus.to);
      }
      this.box.reveal(this.el);
      this.flashLines();
    };
    if (then) {
      const got = await this.data.pastSource(then.past.snapshot.id, v.module);
      if (turn !== this.turn || this.current !== i) return;
      const commit = then.past.snapshot.commit?.hash ?? null;
      const shot = "missing" in got ? null : pastText(g, i, got);
      if ("missing" in got || !shot) {
        const why = "missing" in got && got.why ? `: ${escapeHtml(got.why)}` : "";
        frame(
          escapeHtml(("missing" in got && got.file) || v.module),
          `<div class="banner sw-then">As built ${escapeHtml(then.when)}${commit ? ` · <code>${escapeHtml(commit.slice(0, 7))}</code>` : ""}</div>`,
          `<div class="sw-none">Its source at this build is not kept${why}. The panel shows its statement and doc then.</div>`,
        );
        return settle();
      }
      this.code = { file: shot.file, start: shot.start, lines: shot.lines };
      this.resolve = shot.resolve;
      // the text kept is that commit's own: the build read from a clean checkout of it
      const pc = then.past.snapshot.commit;
      if (pc && !pc.dirty && !pc.guessed && (got.from === "tree" || got.from === `git:${pc.hash}`)) {
        const href = this.hooks.githubLink?.(shot.file, pc.hash, shot.start + 1, shot.end + 1);
        if (href) remote = { href, commit: pc.hash };
      }
      // what the pointer is over is asked of nobody: names show what the build knew of them
      this.shown = { module: v.module, start: shot.start, hash: "" };
      const notes = [`<div class="banner sw-then">${escapeHtml(pastNote(then.when, commit, got.check))}</div>`];
      if (v.gen !== undefined) notes.unshift(`<div class="banner">${genNote()}</div>`);
      frame(
        escapeHtml(shot.where),
        notes.join(""),
        this.contextHtml(got.text.split("\n"), shot.start, v.type ?? "", shot.text, shot.resolve, null) +
          `<pre class="code src">${highlightLines(shot.text, (w) => shot.resolve(w))}</pre>` +
          (interpretsHtml(g, i) ? `<div class="sw-interprets">${interpretsHtml(g, i)}</div>` : "") +
          this.generatedHtml(v.name, [...(v.leanName ? [v.leanName] : []), ...(v.also ?? [])]),
      );
      return settle();
    }
    const src = await this.data.source(v.module);
    if (turn !== this.turn || this.current !== i) return;
    if (!src) {
      frame(escapeHtml(v.module), "", `<div class="sw-none">The file could not be read.</div>`);
      this.box.reveal(this.el);
      return;
    }
    const lines = src.text.split("\n");
    const compiled = this.hooks.compiledOf(v.module);
    const edited = !!compiled && !!src.hash && compiled !== src.hash;
    const at = excerptOf(lines, edited, v.name, v.range);
    const notes: string[] = [];
    if (v.gen !== undefined) notes.push(`<div class="banner">${genNote()}${this.still ? "" : " What Lean made of it is below the command."}</div>`);
    const f = this.hooks.fileOf(v.module);
    if (f && (f.state === "failed" || f.state === "unbuilt")) notes.push(`<div class="banner bad">The last build of this file failed: the graph shows it as it was last compiled.</div>`);
    if (edited)
      notes.push(
        at
          ? `<div class="banner warn">This file has changed since it was compiled. Below is its present text, found by name; the statement, the TCB and the review refer to the compiled version.</div>`
          : `<div class="banner bad">This file has changed since it was compiled, and the declaration is not in it any more under this name.</div>`,
      );
    if (!at) {
      frame(escapeHtml(src.file), notes.join(""), `<div class="sw-none">Not found in the present text.</div>`);
      this.box.reveal(this.el);
      return;
    }
    const text = lines.slice(at.start, at.end + 1).join("\n");
    this.code = { file: src.file, start: at.start, lines: text.split("\n") };
    // the file is the build's text: at the build's commit, these lines
    const built = this.hooks.builtCommit?.();
    if (built && !edited) {
      const href = this.hooks.githubLink?.(src.file, built, at.start + 1, at.end + 1);
      if (href) remote = { href, commit: built };
    }
    // names in source are mostly written short: resolved, as Lean would by default, in the
    // namespaces around the declaration and what the file opens before it — and as Lean said,
    // where it has been asked already
    const resolve = resolver(g, v.name, scopeAt(lines, at.start, (n) => namespacesOf(g).has(n)));
    this.resolve = resolve;
    const key = `${v.module}:${src.hash ?? ""}:${at.start}`;
    // what Lean said names the latest build's declarations, which a past graph may not hold
    const known = this.still ? undefined : this.memory.learned.get(key);
    const words: { word: string; at: number }[] = [];
    const code = highlightLines(text, (w, off) => {
      words.push({ word: w, at: off });
      return known?.has(off) ? known.get(off) : resolve(w);
    });
    // Lean starts on the file now, so that the first hover finds it elaborated
    if (src.hash) {
      this.shown = { module: v.module, start: at.start, hash: src.hash };
      if (fresh && !this.still) this.data.hoverOpen(v.module);
    }
    frame(
      `${escapeHtml(src.file)}:${at.start + 1}–${at.end + 1}${edited ? " · present text" : ""}`,
      notes.join(""),
      this.contextHtml(lines, at.start, v.type ?? "", text, resolve, edited ? null : exactContext(src.contexts, v.name, src.hash)) +
        `<pre class="code src">${code}</pre>` +
        // a rule beside the grammar it interprets, and the other way round
        (interpretsHtml(g, i) ? `<div class="sw-interprets">${interpretsHtml(g, i)}</div>` : "") +
        (v.gen !== undefined && !this.still ? `<div class="sw-print"><div class="sw-print-h">#print ${escapeHtml(v.name)}</div><pre class="code" data-sw-print>Asking Lean…</pre></div>` : "") +
        // a notation unit's own Lean constant (its name is not one) with what its command generated
        this.generatedHtml(v.name, [...(v.leanName ? [v.leanName] : []), ...(v.also ?? [])]),
      this.still ? null : this.hooks.editorLink(g, i, edited ? { line: at.start + 1, col: 1 } : undefined),
    );
    if (v.gen !== undefined && !this.still) {
      const out = this.el.querySelector<HTMLElement>("[data-sw-print]");
      if (out) void this.printInto(turn, i, v.name, out);
    }
    // what the reader opened before the window was drawn again, and Lean has not answered yet
    for (const out of this.el.querySelectorAll<HTMLElement>(".sw-gen-row [data-sw-print]:not([hidden])")) {
      const name = out.parentElement?.querySelector<HTMLElement>("[data-sw-gen]")?.dataset.swGen;
      if (name && !this.memory.printed.has(name)) void this.printInto(turn, i, name, out);
    }
    settle();
    if (src.hash && !known && !this.still) void this.learn(turn, v.name, key, v.module, src.hash, text, at.start, words, resolve);
  }

  /** The context the code on show is written in, as Lean, muted above it: folded when long to
   *  its first lines and its namespaces and sections, with the `variable`s the declaration uses
   *  marked and always shown — those Lean included in it where the context is the elaborator's
   *  (`exact`, the usage pass's), else those that seem to be (a name of theirs in its statement or
   *  its text). */
  private contextHtml(lines: string[], start: number, type: string, text: string, resolve: (w: string) => string | null, exact: FileContext | null): string {
    const ctx = contextLines(readContext(lines, start, exact));
    if (!ctx.length) return "";
    const used = usedVariables(ctx, [type, text], !!exact);
    const FIRST = 3, LONG = 6;
    const long = ctx.length > LONG;
    let hidden = 0;
    const rows = ctx.map((l, k) => {
      // what is always shown: the first lines, the namespaces and sections it sits in, what it
      // seems to use, and what holds for it alone
      const keep = !long || k < FIRST || l.kind === "namespace" || l.kind === "section" || l.kind === "mutual" || used.has(k) || / in$/.test(l.text);
      if (!keep) hidden++;
      const cls = `sw-ctx-l${used.has(k) ? " used" : ""}${keep ? "" : " fold"}`;
      const tip = !used.has(k) ? "" : exact ? ` title="Lean included this variable in the declaration"` : ` title="A name it binds occurs in this declaration: Lean may include it"`;
      return `<div class="${cls}"${tip}>${highlightLines(l.text, (w) => resolve(w))}</div>`;
    });
    const more = hidden ? `${hidden} more` : "";
    return (
      `<div class="sw-ctx${this.ctxOpen ? " open" : ""}${exact ? " exact" : ""}" aria-label="The context it is written in" title="${exact ? "The context as Lean elaborated it" : "The context, read from the file's text"}">` +
      `<div class="code">${rows.join("")}</div>` +
      (more ? `<button class="link sw-ctx-more" data-sw-ctx="${more}">${this.ctxOpen ? "fewer" : more}</button>` : "") +
      `</div>`
    );
  }

  /** The declarations Lean generated from the command on show, folded into its unit: each with a
   *  button that asks Lean's `#print` for it; on a past graph, their names alone, Lean knowing only
   *  the latest build. */
  private generatedHtml(unit: string, also: readonly string[]): string {
    if (!also.length) return "";
    const shortOf = (a: string) => (a.startsWith(unit + ".") ? a.slice(unit.length + 1) : a.split(".").pop()!);
    if (this.still) return `<div class="sw-print"><div class="sw-print-h">What Lean generated from this command</div>${also.map((a) => `<div class="sw-gen-row"><code title="${escapeHtml(a)}">${escapeHtml(shortOf(a))}</code></div>`).join("")}</div>`;
    const rows = also
      .map((a) => {
        const short = shortOf(a);
        const open = this.printOpen.has(a);
        return (
          `<div class="sw-gen-row"><button class="link sw-gen-name" data-sw-gen="${escapeHtml(a)}" title="What Lean made of ${escapeHtml(a)} (#print)">` +
          `<span class="sw-gen-cmd">#print</span> ${escapeHtml(short)}</button>` +
          `<pre class="code" data-sw-print${open ? "" : " hidden"}>${this.memory.printed.get(a) ?? "Asking Lean…"}</pre></div>`
        );
      })
      .join("");
    return `<div class="sw-print"><div class="sw-print-h">What Lean generated from this command</div>${rows}</div>`;
  }

  /** What Lean's `#print` says of a declaration generated from the command on show, into `pre`;
   *  asked again while Lean is still loading the module's imports. */
  private async printInto(turn: number, i: number, name: string, pre: HTMLElement): Promise<void> {
    const v = this.g.nodes[i];
    for (let tries = 0; tries < 30; tries++) {
      const r = await this.data.print(v.module, name);
      if (turn !== this.turn || this.current !== i || !pre.isConnected) return;
      if (r && r.pending) {
        pre.textContent = "Lean is loading the module's imports…";
        await new Promise((ok) => setTimeout(ok, 2000));
        continue;
      }
      const said = (r?.messages ?? []).filter((m) => m.severity === "information").map((m) => m.text).join("\n\n");
      const errors = (r?.messages ?? []).filter((m) => m.severity === "error").map((m) => m.text).join("\n");
      pre.innerHTML = said ? highlightLines(said, (w) => this.resolve?.(w) ?? null) : escapeHtml(r?.error ?? (errors || "Lean said nothing."));
      // an answer is kept for the window drawn again; a failure is asked again next time
      if (said) {
        this.memory.printed.set(name, pre.innerHTML);
        if (this.memory.printed.size > 64) this.memory.printed.delete(this.memory.printed.keys().next().value!);
      }
      return;
    }
  }

  /** Ask Lean what each name in the code on show means (server/hover.ts, `names`), and link the
   *  names by its answers: a declaration where it names one, nothing where it names a variable;
   *  the page's own reading stays where Lean says nothing. */
  private async learn(
    turn: number,
    self: string,
    key: string,
    module: string,
    hash: string,
    text: string,
    start: number,
    words: { word: string; at: number }[],
    resolve: (w: string) => string | null,
  ): Promise<void> {
    const g = this.g;
    const lineStarts = [0];
    for (let k = 0; k < text.length; k++) if (text[k] === "\n") lineStarts.push(k + 1);
    const lineOf = (off: number) => {
      let l = 0;
      while (l + 1 < lineStarts.length && lineStarts[l + 1] <= off) l++;
      return l;
    };
    // one position per part of each name: `o.elim` is `o`, then `elim`
    const parts: { word: number; seg: string }[] = [];
    const positions: [number, number][] = [];
    words.forEach((w, wi) => {
      if (KEYWORDS.has(w.word)) return;
      let off = w.at;
      for (const seg of w.word.split(".")) {
        if (seg && seg !== "_") {
          const l = lineOf(off);
          parts.push({ word: wi, seg });
          positions.push([start + l, off - lineStarts[l]]);
        }
        off += seg.length + 1;
      }
    });
    if (!positions.length) return;
    let heads: (string | null)[] | undefined;
    for (let tries = 0; tries < 120 && !heads; tries++) {
      const res = await this.data.names(module, positions, hash);
      if (turn !== this.turn || !res || res.stale || res.error) return;
      if (res.pending) await new Promise((ok) => setTimeout(ok, 1000));
      else heads = res.heads;
    }
    if (!heads || turn !== this.turn) return;
    const byWord = new Map<number, (string | null)[]>();
    parts.forEach((p, k) => {
      const segs = byWord.get(p.word) ?? [];
      segs.push(heads![k]);
      byWord.set(p.word, segs);
    });
    const learned = new Map<number, RefAnswer>();
    for (const [wi, segHeads] of byWord) {
      const { word, at } = words[wi];
      const segs = word.split(".").filter((s) => s && s !== "_");
      if (segs.length !== segHeads.length) continue;
      // the whole name means one declaration: `Equiv.refl`, or `Prime.two_le` under an `open Nat`
      const c = segHeads[segHeads.length - 1];
      if (c && g.byName.has(c) && segHeads.every((h) => h === c) && (c === word || c.endsWith(`.${word}`))) {
        learned.set(at, c === self ? null : c);
        continue;
      }
      // part by part: a declaration where Lean names one, nothing where it names a variable
      const each = segs.map((seg, k) => {
        const h = segHeads[k];
        if (h && h !== self && g.byName.has(h) && (h.split(".").pop() === seg || /^[0-9]+$/.test(seg))) return h;
        return h === seg ? null : undefined;
      });
      if (each.some((x) => typeof x === "string")) {
        if (segs.length === word.split(".").length) learned.set(at, each.map((x) => x ?? null));
      } else if (segs.length === 1 && each[0] === null) learned.set(at, null);
    }
    this.memory.learned.set(key, learned);
    if (this.memory.learned.size > 64) this.memory.learned.delete(this.memory.learned.keys().next().value!);
    const pre = this.el.querySelector<HTMLElement>("pre.src");
    if (!pre || turn !== this.turn) return;
    pre.innerHTML = highlightLines(text, (w, off) => (learned.has(off) ? learned.get(off) : resolve(w)));
    this.flashLines();
  }
}

/** The offset in `root`'s text of a place in it (a node and an offset there, as a selection gives
 *  them): the length of the text before it. */
function offsetIn(root: Node, node: Node, off: number): number {
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(node, off);
  return r.toString().length;
}

/** "Open on GitHub" (DeploySpec decision 13): the declaration's lines in the build's commit, in a
 *  tab of its own. */
function githubAnchor(href: string, commit: string): string {
  return `<a class="link editor-link gh-link" href="${escapeHtml(href)}" target="_blank" rel="noopener" title="These lines at ${escapeHtml(commit.slice(0, 7))}, the commit of the build shown, on GitHub">Open on GitHub</a>`;
}
