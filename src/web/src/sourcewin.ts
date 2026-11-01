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
// A declaration outside the project is shown the same way (the owner's decision of 2026-10-20), from
// its package's file — Mathlib's, Batteries', Lean's core's — at the place its `.olean` records
// (server/outside.ts), with Lean's hovers, the title bar naming the package and its revision, and
// "Open on GitHub" at that revision where the package is on GitHub. Where the package is at another
// revision than when the graph was read, the declaration is found by name in the present text, as in
// a file changed since it was compiled.
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
// Beside the code and the context, muted, are the file's own line numbers (the owner's decision of
// 2026-10-20; web/src/gutter.ts): drawn by the style, outside the text, so that copying, quoting and
// Lean's positions count in the source alone; a past build's are that build's, an outside file's
// its own.
//
// Above the code, muted, is the context it is written in (TCBSpec.md, decision 4; shared/context.ts):
// the namespaces, opens, variables, options in force there, as Lean, folded when long; the
// `variable`s it seems to use are marked. An opinion records it with the text. Below the code of a
// unit, the declarations Lean generated from its command (ViewNode.also), each with what Lean's
// `#print` says of it when asked.
//
// Beside the code, or below it in a narrow window, the InfoView (ReviewSpec, "The InfoView"; the
// owner's decisions of 2026-11-01; web/src/infoview.ts): what Lean says at the caret — a click in the
// code, the keyboard's caret, ↑ and ↓ —, the goals before and after the tactic there, the expected
// type of the term. The window tells it the code on show and maps a place of its text to the file's
// line and column, as for hovers.
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
import { outsideLink, packageWords } from "../../shared/outside.ts";
import { cascadeRect, EDGE, FloatWindow } from "./floatwin.ts";
import type { Rect, Size } from "./floatwin.ts";
import { contextGutter, cutMarks, gutterDigits, rowMarks } from "./gutter.ts";
import { escapeHtml, highlightLean, highlightLines, KEYWORDS, renderDoc, renderHover } from "./highlight.ts";
import { genNote, interpretsHtml } from "./panel.ts";
import type { PastGraph } from "./past.ts";
import { pastNote, pastText } from "./pastsource.ts";
import type { RefAnswer } from "./highlight.ts";
import { afterClick, HoverCards } from "./hovercards.ts";
import { caretOf, InfoView } from "./infoview.ts";
import type { Caret, InfoCode } from "./infoview.ts";
import { FLASH_MS } from "./reviewbox.ts";
import type { ReviewBox } from "./reviewbox.ts";
import { editorAnchor } from "./editor.ts";
import { namespacesOf, resolver, scopeAt } from "./scope.ts";
import { scopesAt } from "../../shared/scope.ts";
import { asideRect, MIN, openBounds, openRect } from "./sources.ts";
import { kindDot } from "./axiomring.ts";
import { reducedMotion } from "./theme.ts";
import type { SourcePane } from "./sources.ts";
import { chunksOf, declAt, FILE_MARK_LABEL, fileDecls, fileMark, proofFolds, sameText } from "./filemode.ts";
import type { Chunk, FileDecl, FileMark, Fold, SourceMode } from "./filemode.ts";
import type { ReviewData } from "../../shared/review.ts";
import type { OutsideWhere } from "../../shared/outside.ts";
import type { LineDecor } from "./highlight.ts";

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
  /** the InfoView hidden by the reader, in every window (kept in the browser), and hiding it */
  infoHidden?(): boolean;
  hideInfo?(on: boolean): void;
  /** the reader put the InfoView's caret in window `w`, or turned it to before or after: the page's
   *  one caret is there now, and those following are told */
  caretMoved?(w: SourceWindow): void;
  /** the reader follows someone: a click in the code is reading, the caret the followed reader's */
  following?(): boolean;
  /** File mode (the owner's decisions of 2026-11-01): the review graph `g` is read with, for the
   *  marks in the gutter (the board's: a past graph's under its names then) */
  review(g: Graph): ReviewData;
  /** whether some target's review set holds declaration `i` of graph `g`; null where the page has no
   *  targets to say it by */
  inReview(g: Graph): ((i: number) => boolean) | null;
  /** the text module `module` was compiled from, the latest build's as the history keeps it
   *  (HistorySpec decision 20): in a file changed since, what tells the declarations whose text is
   *  still the one compiled; null where it is not kept */
  compiledText(module: string): Promise<string[] | null>;
  /** whether File mode folds proofs: the reader's own, kept in the browser; and its change */
  foldProofs(): boolean;
  setFoldProofs(on: boolean): void;
  /** the window was switched to the other mode: what the others are told changed */
  moded(w: SourceWindow): void;
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
/** what a file window's anchor starts with: no declaration's name does */
const FILE_ANCHOR = "⟨file⟩";
/** a sheet with a folded corner: a file window's mark in its title bar and its pill */
const FILE_GLYPH = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 1.8h5.2L12.5 5v9.2H4zM9 1.8V5.2h3.4"/></svg>`;
/** File mode's width while it is fitted, the same whatever part of the file is drawn yet: a hundred
 *  characters of code and the gutter, and room beside them for most of the InfoView's pane, where the
 *  screen has it */
const FILE_W = 1040;
/** the height a line of File mode's code takes before it is laid out: what a piece off the screen
 *  stands as (12.5 px at 1.55) */
const LINE_H = 19.4;
/** the most positions Lean is asked about at once (server/appgraph.ts takes 5,000) */
const NAMES_MAX = 5000;

/** "Open on GitHub": where, at which commit, and of which package outside the project. */
type Remote = { href: string; commit: string; what?: string };

/** File mode as the window draws it (web/src/filemode.ts). */
interface WholeFile {
  g: Graph;
  module: string;
  /** the text on show, its file and its Lake hash ("" where Lean is not asked: a past build's) */
  text: string;
  file: string;
  hash: string;
  lines: string[];
  era: "now" | "then";
  /** changed since it was compiled (or, outside the project, its package at another revision) */
  edited: boolean;
  decls: FileDecl[];
  chunks: Chunk[];
  /** per piece, the declaration it is written for (whose own name links nowhere) and how a name in
   *  it resolves: from the namespaces and opens in force where it starts */
  selfs: string[];
  resolvers: ((w: string) => string | null)[];
  folds: Fold[];
  /** per declaration (as `decls`), its mark; null where none is shown: its text not the compiled one */
  marks: (FileMark | null)[];
  /** the text compiled, for a file changed since; null where not kept, or not asked */
  compiled: string[] | null;
}

/** What File mode says of a declaration it does not find in the text on show: it has no place
 *  recorded, or it is not there (any more). */
function notThere(v: Graph["nodes"][number], era: "now" | "then"): string {
  return v.range
    ? `<div class="banner bad">${escapeHtml(v.name)} is not in this text${era === "then" ? " at this build" : " any more under this name"}.</div>`
    : `<div class="banner">No source position was recorded for ${escapeHtml(v.name)}.</div>`;
}

/** The piece of `chunks` holding line `line`, or -1. */
function chunkAt(chunks: readonly Chunk[], line: number): number {
  let lo = 0, hi = chunks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chunks[mid].end < line) lo = mid + 1;
    else if (chunks[mid].start > line) hi = mid - 1;
    else return mid;
  }
  return -1;
}

/** The title bar's switch between the window's two modes (the owner's decision of 2026-11-01). A
 *  file window has no declaration of its own: Declaration is not to be had there. */
function modeSwitch(mode: SourceMode, fileOnly: boolean): string {
  const b = (m: SourceMode, label: string, title: string) =>
    `<button type="button" data-sw-mode="${m}" aria-pressed="${mode === m}"${m === "decl" && fileOnly ? " disabled" : ""} title="${escapeHtml(title)}">${label}</button>`;
  return (
    `<span class="sw-mode" role="group" aria-label="Show">` +
    b("decl", "Declaration", fileOnly ? "This window is on the file, not on a declaration: a name in it, or the bar over the code, selects one" : "The declaration, with the context it is written in") +
    b("file", "File", "The whole file it is in, the declaration highlighted") +
    `</span>`
  );
}

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
  /** the word the reader last clicked into with the mouse: no card for it until the pointer is on
   *  another word (hovercards.ts, afterClick); "" for none */
  private clicked = "";
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
  /** the InfoView: what Lean says at the caret (web/src/infoview.ts) */
  private info: InfoView;
  /** when a key was last pressed in the window: the keyboard's caret moves the selection */
  private keyAt = 0;
  /** what it shows (the owner's decision of 2026-11-01): the declaration, or the whole file it is in */
  mode: SourceMode = "decl";
  /** a file window, opened on a file by its module (the Files tree, the board's menu; the owner's
   *  decision of 2026-11-01): File mode alone, with no declaration of its own; null on a declaration */
  file: string | null = null;
  /** File mode as drawn: kept while the window steps to another declaration of the same text, which
   *  moves only what is the declaration's, the reader's place staying */
  private whole: WholeFile | null = null;
  /** the proofs opened one by one while proofs are folded, by where they start */
  private openFolds = new Set<string>();
  /** where File mode, once drawn, scrolls: to the window's declaration (opening, a switch of mode),
   *  a file window's top */
  private scrollWanted = false;
  private stickyWait = 0;
  /** File mode's pieces coming into sight: Lean is asked about the names of each then */
  private seen: IntersectionObserver | null = null;

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
          let b = openBounds(vp, this.aside ? this.hooks.top() : EDGE);
          // the whole file: as tall as it may be, at one width whatever is drawn of it yet
          if (this.mode === "file") {
            const w = Math.min(b.max.w, Math.max(b.min.w, FILE_W));
            b = { max: { w, h: b.max.h }, min: { w, h: b.max.h } };
          }
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
    // a click into the code with the mouse puts the InfoView's caret there: the card of the word
    // under it goes, and none comes for that word until the pointer is on another (afterClick). A
    // finger's tap, and the keyboard, as before
    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      const pre = (e.target as HTMLElement).closest?.("pre.src") as HTMLElement | null;
      if (!pre || !this.shown) return;
      this.hideTip();
      this.clicked = this.positionAt(pre, e.clientX, e.clientY)?.word ?? "";
    });
    document.addEventListener("selectionchange", this.onSelection);
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-sw-quote]")) return this.quotePicked();
      if (t.closest("[data-sw-close]")) return this.hooks.close(this);
      if (t.closest("[data-sw-pin]")) return this.hooks.pin(this);
      if (t.closest("[data-sw-back]")) return this.hooks.back();
      if (t.closest("[data-sw-fwd]")) return this.hooks.forward();
      if (t.closest(".sw-pill, [data-sw-collapse]")) return;
      // the switch between the declaration and the whole file, a control of what is followed as the
      // pin is (CollabSpec, "Surfaces")
      const mode = t.closest<HTMLElement>("[data-sw-mode]");
      if (mode) return this.setMode(mode.dataset.swMode === "file" ? "file" : "decl");
      // the reader's own: proofs folded, and a folded one opened
      if (t.closest("[data-sw-folds]")) return this.foldProofs(!this.hooks.foldProofs());
      const fold = t.closest<HTMLElement>("[data-pf-open]");
      if (fold) return this.openFold(fold.dataset.pfOpen!);
      // the sticky header: the declaration the reading position is in, selected as any (it ends
      // following as a selection does); scrolling itself selects nothing
      const here = t.closest<HTMLElement>("[data-sw-at]");
      if (here) {
        if (this.g.byName.has(here.dataset.swAt!)) this.hooks.go(here.dataset.swAt!);
        return;
      }
      const ref = t.closest<HTMLElement>("[data-ref]");
      if (ref) {
        if (this.g.byName.has(ref.dataset.ref!)) this.hooks.go(ref.dataset.ref!);
        return;
      }
      // a click in the code, not a drag that selected some: the InfoView's caret there
      const pre = t.closest<HTMLElement>("pre.src");
      if (pre && document.getSelection()?.isCollapsed !== false) return this.caretAtPoint(pre, e.clientX, e.clientY);
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
    this.info = new InfoView({
      goals: (m, line, ch, hash) => this.data.goals(m, line, ch, hash),
      subterm: (m, line, ch, hash, k) => this.data.subterm(m, line, ch, hash, k),
      // as the names of the code at the caret resolve: the declaration's, or in File mode the piece's
      resolve: (w) => {
        const r = this.namesAt(this.info?.caret?.line ?? 0).resolve;
        return r ? r(w) : this.g.byName.has(w) ? w : null;
      },
      cards: this.cards,
      card: (name) => ({ html: this.fromGraph(name), more: this.describe(name) }),
      hidden: () => this.hooks.infoHidden?.() ?? false,
      hide: (on) => this.hooks.hideInfo?.(on),
      moved: () => this.hooks.caretMoved?.(this),
      win: () => this.el,
      fitted: () => this.win.fitted,
      stale: () => void this.render(false),
    });
    // ↑ and ↓ step the InfoView's caret from tactic to tactic, where it is in this window
    el.addEventListener("keydown", (e) => {
      this.keyAt = Date.now();
      if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement;
      if (t.closest?.("input, textarea, select, [contenteditable]")) return;
      if (this.info.step(e.key === "ArrowDown" ? 1 : -1)) e.preventDefault();
    });
    el.addEventListener("mousemove", (e) => {
      // the InfoView's own cards: its subterms and names
      if ((e.target as HTMLElement).closest?.(".sw-info")) return;
      const pre = (e.target as HTMLElement).closest?.("pre.src") as HTMLElement | null;
      this.pointer = pre ? { pre, x: e.clientX, y: e.clientY } : null;
      if (this.hoverWait) clearTimeout(this.hoverWait);
      // selecting, or something selected in the code: its quote button, not a card, is beside it
      if (e.buttons || this.picked) return;
      // off the code: the cards close unless the pointer is on its way onto one
      if (!pre || !this.shown) {
        this.clicked = "";
        return this.cards.leave();
      }
      const { clientX: x, clientY: y } = e;
      this.hoverWait = setTimeout(() => this.pointAt(pre, x, y), 120);
    });
    el.addEventListener("mouseleave", () => {
      this.pointer = null;
      this.clicked = "";
      if (this.hoverWait) clearTimeout(this.hoverWait);
      this.cards.leave();
    });
    // a scroll moves the code from under the tooltip; once it stops, what is under the pointer now
    el.addEventListener(
      "scroll",
      () => {
        this.hideTip();
        this.stickyLater();
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

  /** A file window on module `module` (the owner's decision of 2026-11-01): the whole file in File
   *  mode from its top, not tied to the selection, with no declaration of its own; drawn again where
   *  it is on it already. */
  showFile(module: string): void {
    const first = !this.drawnOnce && this.file === null && this.current < 0;
    const fresh = module !== this.file;
    this.file = module;
    this.mode = "file";
    this.current = -1;
    this.name = "";
    if (fresh) this.scrollWanted = true;
    void this.render(fresh);
    if (first) this.win.layout();
  }

  /** What a page finds it by in its windows, and others' pointers in it: its declaration's name, a
   *  file window's module under a mark of its own (no declaration's name is written so). */
  get anchor(): string {
    return this.file !== null ? `${FILE_ANCHOR}${this.file}` : this.name;
  }

  /** Shown in mode `m` (the owner's decision of 2026-11-01): its declaration, or the whole file it
   *  is in, scrolled to it; switched by the reader in the title bar, or as a followed reader's window
   *  is. A file window has File mode alone. */
  setMode(m: SourceMode): void {
    if (m === this.mode || (this.file !== null && m === "decl")) return;
    this.mode = m;
    this.scrollWanted = true;
    this.unpick();
    // fitted again to what it shows, where the reader has not placed it
    if (this.current >= 0) void this.render(true).then(() => this.win.layout());
    this.hooks.moded(this);
  }

  /** Laid out again where it is kept or fitted: a reference window paired beside it, or gone,
   *  changes the room it has. */
  relayout(): void {
    if (this.current >= 0 || this.file !== null) this.win.layout();
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
    // File mode's marks are the review's too
    if (this.mode === "file" && !this.reading) this.refreshMarks();
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
    if (this.current < 0 && this.file === null) return;
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
    if (this.stickyWait) cancelAnimationFrame(this.stickyWait);
    this.seen?.disconnect();
    this.pointer = null;
    this.shown = null;
    this.cards.dispose();
    this.info.dispose();
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
    const s = document.getSelection();
    this.caretChanged(s);
    const range = s && !s.isCollapsed && s.rangeCount ? s.getRangeAt(0) : null;
    const c = this.code;
    // the code's blocks: one in Declaration mode, File mode's pieces, each from its line (data-line)
    const pres = range ? [...this.el.querySelectorAll<HTMLElement>("pre.src")].filter((p) => range.intersectsNode(p)) : [];
    if (!pres.length || !c || !range || this.collapsed || !this.el.querySelector("[data-rv-comment]")) return this.unpick();
    // where it starts or ends outside the code, from the start of the first block it touches or to
    // the end of the last; offsets in the code's text, its lines joined as in the file
    const text = c.lines.join("\n");
    const starts = [0];
    for (let k = 0; k < c.lines.length; k++) starts.push(starts[k] + c.lines[k].length + 1);
    const base = (pre: HTMLElement) => starts[Math.max(0, Math.min(c.lines.length - 1, Number(pre.dataset.line ?? c.start) - c.start))];
    const first = pres[0], last = pres[pres.length - 1];
    const from = first.contains(range.startContainer) ? base(first) + offsetIn(first, range.startContainer, range.startOffset) : base(first);
    const to = last.contains(range.endContainer) ? base(last) + offsetIn(last, range.endContainer, range.endOffset) : base(last) + (last.textContent ?? "").length;
    const picked = selectedLines(text, from, to);
    const body = first.closest<HTMLElement>(".sw-body");
    const end = picked && this.lineEl(c.start + picked.last);
    if (!picked || !body || !end) return this.unpick();
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
    b.style.top = `${end.getBoundingClientRect().bottom - body.getBoundingClientRect().top + 3}px`;
  }

  /** The element of line `line` of the file (from 0) in the code on show, or null: the code's
   *  blocks each say the line they start at (`data-line`), one block in Declaration mode, File
   *  mode's pieces. */
  private lineEl(line: number): HTMLElement | null {
    for (const pre of this.el.querySelectorAll<HTMLElement>("pre.src")) {
      const from = Number(pre.dataset.line ?? 0);
      // File mode's piece not drawn yet (off the screen) says its last line: drawn now
      const to = pre.dataset.end !== undefined ? Number(pre.dataset.end) : from + pre.children.length - 1;
      if (line < from || line > to) continue;
      if (pre.dataset.end !== undefined) this.fill(pre);
      return (pre.children[line - from] as HTMLElement | undefined) ?? null;
    }
    return null;
  }

  /** The keyboard's caret moved in the code (caret browsing: the selection collapsed there, a key just
   *  pressed) puts the InfoView's caret there, as a click does (caretAtPoint). */
  private caretChanged(s: Selection | null): void {
    if (!s || !s.isCollapsed || !s.rangeCount || Date.now() - this.keyAt > 500) return;
    const r = s.getRangeAt(0);
    const at = r.startContainer.nodeType === Node.ELEMENT_NODE ? (r.startContainer as Element) : r.startContainer.parentElement;
    // the code's block it is in: Declaration mode's one, or a piece of File mode's
    const pre = at?.closest<HTMLElement>("pre.src");
    if (pre && this.el.contains(pre)) this.caretIn(pre, r.startContainer, r.startOffset);
  }

  /** A click or a tap in the code puts the InfoView's caret where it landed. */
  private caretAtPoint(pre: HTMLElement, x: number, y: number): void {
    const d = document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null; caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null };
    const r = d.caretRangeFromPoint?.(x, y);
    const c = r ? null : d.caretPositionFromPoint?.(x, y);
    const node = r ? r.startContainer : c?.offsetNode;
    if (node && pre.contains(node)) this.caretIn(pre, node, r ? r.startOffset : c!.offset);
  }

  /** The InfoView's caret at a place of the code (a node and an offset there), at its line and column
   *  in the file; not while the reader follows someone, whose caret it is (a click is reading then). */
  private caretIn(pre: HTMLElement, node: Node, off: number): void {
    if (!this.shown || !this.code || this.collapsed || this.hooks.following?.()) return;
    // counted in the block's own text from the line it starts at in the file (`data-line`): the
    // declaration's first line, or a piece's of the whole file
    const at = caretOf(pre.textContent ?? "", offsetIn(pre, node, off));
    this.info.place(Number(pre.dataset.line ?? this.shown.start) + at.line, at.ch);
  }

  /** The InfoView's caret: where it is in the file, and whether the goals after the tactic are on
   *  show; null where there is none in this window. */
  get caret(): Caret | null {
    return this.info.caret ? { ...this.info.caret } : null;
  }

  /** The caret as a followed reader's is, or none here (the page's one caret is in another window). */
  followCaret(c: Caret | null): void {
    this.info.follow(c);
  }

  /** The InfoView hidden or shown again by the reader, in every window. */
  infoChanged(): void {
    this.info.draw();
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
    if (!w || !c || !this.el.querySelector("pre.src")) return;
    const now = Date.now();
    if (now > (w.since ? w.since + FLASH_MS : w.until)) {
      this.linesWanted = null;
      return;
    }
    const span = locateLines(c.lines, c.start, w.from, w.to, w.quoted);
    // lines of the file outside the declaration's (quoted from File mode): the whole file shows them
    if (!span && this.mode === "decl" && !this.still) return this.setMode("file");
    if (!span) {
      this.linesWanted = null;
      return this.hooks.say(`Line${w.to > w.from ? `s ${w.from}–${w.to} are` : ` ${w.from} is`} not in the text of ${this.name} ${this.era === "then" ? "at this build" : "now"}.`);
    }
    for (let k = span[0]; k <= span[1]; k++) {
      const l = this.lineEl(c.start + k);
      if (!l) continue;
      l.style.animationDelay = w.since ? `${w.since - now}ms` : "";
      l.classList.add("ln-flash");
    }
    if (!w.since) this.lineEl(c.start + span[0])?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
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

  /** The character of `pre` under (x, y): its line in the file (from 0) and UTF-16 column, and the
   *  box of the word it is in (one part of a dotted name: `o` and `elim` in `o.elim` are different
   *  things); null over nothing (past the end of a line, between lines, in the indentation a
   *  wrapped line hangs from). Lines are counted by the line breaks in the text, which the code
   *  keeps as it wraps (highlightLines): a line wrapped on the screen is one line here; from the
   *  line the block starts at in the file (`data-line`), so that both modes count in the file. */
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
    const at = Number(pre.dataset.line ?? 0) + line;
    return { line: at, ch: abs - (before + 1), word: `${at}:${from - (before + 1)}`, box: range ? range.getBoundingClientRect() : hit.rect };
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
    // the word just clicked into: no card, until the pointer is on another
    const quiet = afterClick(this.clicked, at.word);
    this.clicked = quiet.clicked;
    if (!quiet.show) return;
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

  /** Where a place in the code on show is in its file, as Lean counts it: the line from 0 and the
   *  UTF-16 character, in the module and the text (its Lake hash) on show — in either mode, the
   *  code's blocks each counting from the line they start at in the file (`data-line`), a folded
   *  proof's text being there still, hidden. `node` and `offset` as a caret or a selection's end
   *  gives them; null outside the code, or where no text Lean knows is on show (a past build's).
   *  What the hovers ask Lean at; what a pane beside the code may ask it at too. */
  positionOf(node: Node, offset: number): { module: string; hash: string; line: number; character: number } | null {
    const s = this.shown;
    const e = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const pre = e?.closest<HTMLElement>("pre.src");
    if (!s || !s.hash || !pre || !this.el.contains(pre)) return null;
    const o = offsetIn(pre, node, offset);
    const before = (pre.textContent ?? "").slice(0, o);
    const nl = before.lastIndexOf("\n");
    let line = 0;
    for (let k = before.indexOf("\n"); k >= 0; k = before.indexOf("\n", k + 1)) line++;
    return { module: s.module, hash: s.hash, line: Number(pre.dataset.line ?? 0) + line, character: o - nl - 1 };
  }

  /** How a name written at line `line` of the file on show resolves, and whose own name links
   *  nowhere there: the declaration on show's; in File mode, the piece's there. */
  private namesAt(line: number): { self: string; resolve: ((w: string) => string | null) | null } {
    const w = this.whole;
    if (this.mode !== "file" || !w) return { self: this.current >= 0 ? this.g.nodes[this.current].name : "", resolve: this.resolve };
    const k = chunkAt(w.chunks, line);
    return k < 0 ? { self: "", resolve: null } : { self: w.selfs[k], resolve: w.resolvers[k] };
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
    const res = await this.data.hover(s.module, line, ch, s.hash);
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
    const { self, resolve } = this.namesAt(line);
    // what the card is about: the declaration Lean names first, when it names one
    const head = /^```[^\n]*\n(\S+)/.exec(res.contents)?.[1]?.replace(/\.\{.*$/, "") ?? null;
    const subject = head && this.g.byName.has(head) ? head : null;
    this.showTip(renderHover(res.contents, (w) => (w === self ? w : resolve ? resolve(w) : this.g.byName.has(w) ? w : null)), box, subject);
  }

  private async render(fresh: boolean): Promise<void> {
    if (this.mode === "file") return this.renderFile(fresh);
    const i = this.current;
    if (i < 0) return;
    this.leaveFile();
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
    let remote: { href: string; commit: string; what?: string } | null = null;
    const head = (where: string, editor: string | null) =>
      `<div class="sw-head">${pinned ? "" : nav()}<span class="dot ${kindDot(v.kind, ext)}"></span><span class="sw-name" title="${escapeHtml(v.name)}">${short}</span>` +
      `<span class="sw-ns">${escapeHtml(parts.slice(0, -1).join("."))}</span><span class="sw-loc">${where}</span>` +
      (editor ? editorAnchor(editor) : "") +
      (remote ? githubAnchor(remote.href, remote.commit, remote.what) : "") +
      modeSwitch("decl", false) +
      `<span class="sw-acts">${pin}<button class="icon" data-sw-collapse aria-label="Collapse" title="Collapse to one line (or double-click the title bar)">${COLLAPSE}</button>` +
      `<button class="icon sw-close" data-sw-close aria-label="Close" title="${pinned ? "Close (Esc)" : "Close (Esc, or Space)"}">✕</button></span></div>`;
    // `final`: the declaration's own frame, not what stands for it while its code is read
    const frame = (where: string, notes: string, body: string, editor = this.still ? null : this.hooks.editorLink(g, i), final = true) => {
      this.el.setAttribute("aria-label", `Source of ${v.name}${pinned ? ", pinned" : ""}`);
      this.frameEl.innerHTML =
        `${head(where, editor)}${this.pairHtml()}${notes}` +
        `<div class="sw-scroll"><div class="sw-split"><div class="sw-body">${body}</div><aside class="sw-info" hidden></aside></div><div class="sw-review">${this.box.html(i)}</div></div>`;
      // collapsed, a pill with the declaration's name; a click opens the window again
      this.pillEl.innerHTML =
        `<button class="sw-pill-open" type="button" title="Open the source of ${escapeHtml(v.name)} again"><span class="dot ${kindDot(v.kind, ext)}"></span>` +
        `<span class="sw-pill-name">${short}</span>${pinned ? `<span class="sw-pinned" aria-label="Pinned">${PIN}</span>` : ""}</button>` +
        `<button class="icon sw-close" data-sw-close aria-label="Close" title="Close">✕</button>`;
      if (final) this.drew();
    };
    if (!v.range) {
      frame(escapeHtml(v.module), "", `<div class="sw-none">No source position was recorded for it.</div>`);
      this.attachInfo(null);
      this.box.reveal(this.el);
      return;
    }
    if (fresh) this.awaitCode(turn, () => frame(escapeHtml(v.module), "", `<div class="sw-none">Reading the source…</div>`, undefined, false));
    /** the code the InfoView is about, once drawn, and why Lean is not asked about it */
    let infoCode: InfoCode | null = null;
    /** the window drawn: where the reader was in it, and what a click in a comment asked for */
    const settle = () => {
      this.attachInfo(infoCode);
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
        // outside the project, that build's source was not kept (HistorySpec decision 24)
        frame(
          escapeHtml(("missing" in got && got.file) || v.module),
          `<div class="banner sw-then">As built ${escapeHtml(then.when)}${commit ? ` · <code>${escapeHtml(commit.slice(0, 7))}</code>` : ""}</div>`,
          ext
            ? `<div class="sw-none">Its source at this build was not kept${why}.</div>`
            : `<div class="sw-none">Its source at this build is not kept${why}. The panel shows its statement and doc then.</div>`,
        );
        return settle();
      }
      this.code = { file: shot.file, start: shot.start, lines: shot.lines };
      this.resolve = shot.resolve;
      // the text kept is that commit's own: the build read from a clean checkout of it; outside the
      // project, the package's at the revision it had then, which it has now
      const pc = then.past.snapshot.commit;
      const out = got.outside ? outsideLink(got.outside, shot.start + 1, shot.end + 1) : null;
      if (out && got.outside?.github) remote = { href: out, commit: got.outside.github.rev, what: packageWords(got.outside) };
      else if (!got.outside && pc && !pc.dirty && !pc.guessed && (got.from === "tree" || got.from === `git:${pc.hash}`)) {
        const href = this.hooks.githubLink?.(shot.file, pc.hash, shot.start + 1, shot.end + 1);
        if (href) remote = { href, commit: pc.hash };
      }
      // what the pointer is over is asked of nobody: names show what the build knew of them
      this.shown = { module: v.module, start: shot.start, hash: "" };
      infoCode = { module: v.module, start: shot.start, text: shot.text, hash: "", off: "A past build has no InfoView: Lean knows only the latest build. Its goals are there, in the window of the board of now." };
      const notes = [`<div class="banner sw-then">${escapeHtml(pastNote(then.when, commit, got.check, got.outside))}</div>`];
      if (v.gen !== undefined) notes.unshift(`<div class="banner">${genNote()}</div>`);
      frame(
        escapeHtml(shot.where),
        notes.join(""),
        this.contextHtml(got.text.split("\n"), shot.start, v.type ?? "", shot.text, shot.resolve, null) +
          codeHtml(highlightLines(shot.text, (w) => shot.resolve(w), shot.start + 1), shot.start, shot.text) +
          (interpretsHtml(g, i) ? `<div class="sw-interprets">${interpretsHtml(g, i)}</div>` : "") +
          this.generatedHtml(v.name, [...(v.leanName ? [v.leanName] : []), ...(v.also ?? [])]),
      );
      return settle();
    }
    const src = await this.data.source(v.module);
    if (turn !== this.turn || this.current !== i) return;
    if (!src) {
      frame(escapeHtml(v.module), "", `<div class="sw-none">${ext ? "A declaration from outside the project: its source is not found here." : "The file could not be read."}</div>`);
      this.attachInfo(null);
      this.box.reveal(this.el);
      return;
    }
    const lines = src.text.split("\n");
    // outside the project, what was read is its package at the revision the graph was read at
    const out = src.outside;
    const compiled = this.hooks.compiledOf(v.module);
    const edited = out ? !!out.changed : !!compiled && !!src.hash && compiled !== src.hash;
    const at = excerptOf(lines, edited, v.name, v.range);
    const notes: string[] = [];
    if (v.gen !== undefined) notes.push(`<div class="banner">${genNote()}${this.still ? "" : " What Lean made of it is below the command."}</div>`);
    const f = this.hooks.fileOf(v.module);
    if (f && (f.state === "failed" || f.state === "unbuilt")) notes.push(`<div class="banner bad">The last build of this file failed: the graph shows it as it was last compiled.</div>`);
    if (edited && out)
      notes.push(
        at
          ? `<div class="banner warn">${escapeHtml(out.core ? "The toolchain" : out.package)} is at another revision than when the graph was read (${escapeHtml(packageWords(out))} now). Below is its present text, found by name; the graph refers to what was read then.</div>`
          : `<div class="banner bad">${escapeHtml(out.core ? "The toolchain" : out.package)} is at another revision than when the graph was read (${escapeHtml(packageWords(out))} now), and the declaration is not in it any more under this name.</div>`,
      );
    else if (edited)
      notes.push(
        at
          ? `<div class="banner warn">This file has changed since it was compiled. Below is its present text, found by name; the statement, the TCB and the review refer to the compiled version.</div>`
          : `<div class="banner bad">This file has changed since it was compiled, and the declaration is not in it any more under this name.</div>`,
      );
    // outside the project, the package it is in, before its file
    const place = (out ? `${packageWords(out)} · ` : "") + src.file;
    if (!at) {
      frame(escapeHtml(place), notes.join(""), `<div class="sw-none">Not found in the present text.</div>`);
      this.attachInfo(null);
      this.box.reveal(this.el);
      return;
    }
    const text = lines.slice(at.start, at.end + 1).join("\n");
    this.code = { file: src.file, start: at.start, lines: text.split("\n") };
    // the file is the build's text: at the build's commit, these lines; outside the project, the
    // package's at its revision (DeploySpec decision 13)
    const built = out ? null : this.hooks.builtCommit?.();
    const outHref = out && !edited ? outsideLink(out, at.start + 1, at.end + 1) : null;
    if (outHref && out?.github) remote = { href: outHref, commit: out.github.rev, what: packageWords(out) };
    if (built && !edited) {
      const href = this.hooks.githubLink?.(src.file, built, at.start + 1, at.end + 1);
      if (href) remote = { href, commit: built };
    }
    // names in source are mostly written short: resolved, as Lean would by default, in the
    // namespaces around the declaration and what the file opens before it — and as Lean said,
    // where it has been asked already
    const resolve = resolver(g, v.name, scopeAt(lines, at.start, (n) => namespacesOf(g).has(n)));
    this.resolve = resolve;
    // what Lean said of the names of these lines: shared with File mode's piece of the same lines
    const key = `${v.module}:${src.hash ?? ""}:${at.start}-${at.end}`;
    // what Lean said names the latest build's declarations, which a past graph may not hold
    const known = this.still ? undefined : this.memory.learned.get(key);
    const words: { word: string; at: number }[] = [];
    const code = highlightLines(
      text,
      (w, off) => {
        words.push({ word: w, at: off });
        return known?.has(off) ? known.get(off) : resolve(w);
      },
      at.start + 1,
    );
    // the InfoView: Lean's goals are of the build's text alone (ReviewSpec, "The InfoView")
    infoCode = {
      module: v.module,
      start: at.start,
      text,
      hash: src.hash ?? "",
      off: this.data.snapshot
        ? "A snapshot of the page has no InfoView: there is no Lean in it. The server's page shows the goals."
        : edited && out
          ? `${out.core ? "The toolchain" : out.package} is at another revision than when the graph was read: its goals would be another text's than Lean checked.`
          : edited
            ? "This file has changed since it was compiled: its goals would be the present text's, not what Lean checked. They come back once it is compiled again."
            : !src.hash
              ? "Lean cannot be asked about this file here."
              : null,
    };
    // Lean starts on the file now, so that the first hover finds it elaborated, and the InfoView's
    // first answer
    if (src.hash) {
      this.shown = { module: v.module, start: at.start, hash: src.hash };
      if (fresh && !this.still) this.data.hoverOpen(v.module);
    }
    frame(
      `${escapeHtml(place)}:${at.start + 1}–${at.end + 1}${edited ? " · present text" : ""}`,
      notes.join(""),
      this.contextHtml(lines, at.start, v.type ?? "", text, resolve, edited ? null : exactContext(src.contexts, v.name, src.hash)) +
        codeHtml(code, at.start, text) +
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
    if (src.hash && !known && !this.still)
      void this.learn(() => turn === this.turn, v.name, key, v.module, src.hash, text, at.start, words, (learned) => {
        const pre = this.el.querySelector<HTMLElement>("pre.src");
        if (!pre) return;
        pre.innerHTML = highlightLines(text, (w, off) => (learned.has(off) ? learned.get(off) : resolve(w)), at.start + 1);
        this.flashLines();
        this.info.marks();
      });
  }

  // ---------------------------------------------------------------- File mode

  /** Out of File mode: what it drew of the file goes. */
  private leaveFile(): void {
    this.whole = null;
    this.seen?.disconnect();
    this.seen = null;
    this.el.classList.remove("sw-file-mode", "sw-folds");
  }

  /** File mode's title bar: the declaration's, as Declaration mode's (its name, its namespace, where
   *  it is, the editor's and GitHub's links), or a file window's, the file's name and folder; the
   *  switch, set on File; the pin, collapse and close. */
  private fileHead(where: string, editor: string | null, remote: Remote | null): string {
    const pinned = this.pinned;
    const nav =
      `<span class="nav"><button data-sw-back title="Back (Alt ←)" aria-label="Back"${this.hooks.steps().back ? "" : " disabled"}>${BACK}</button>` +
      `<button data-sw-fwd title="Forward (Alt →)" aria-label="Forward"${this.hooks.steps().forward ? "" : " disabled"}>${FORWARD}</button></span>`;
    const what = this.file !== null ? `the file ${this.file}` : this.g.nodes[this.current].name;
    const pin = pinned
      ? `<span class="sw-pinned" role="img" aria-label="Pinned" title="Pinned: it stays on ${escapeHtml(what)}, whatever is selected">${PIN}</span>`
      : `<button class="icon sw-pin" data-sw-pin aria-label="Pin" title="Pin: keep this window on ${escapeHtml(what)}; the next source you open (Space) opens in a new window beside it">${PIN}</button>`;
    let title: string;
    if (this.file !== null) {
      const parts = this.file.split(".");
      title = `<span class="sw-glyph">${FILE_GLYPH}</span><span class="sw-name" title="${escapeHtml(this.file)}">${escapeHtml(parts[parts.length - 1])}</span><span class="sw-ns">${escapeHtml(parts.slice(0, -1).join("."))}</span>`;
    } else {
      const v = this.g.nodes[this.current];
      const parts = v.name.split(".");
      title =
        `<span class="dot ${kindDot(v.kind, this.g.isExt(this.current))}"></span><span class="sw-name" title="${escapeHtml(v.name)}">${escapeHtml(v.display ?? parts[parts.length - 1])}</span>` +
        `<span class="sw-ns">${escapeHtml(parts.slice(0, -1).join("."))}</span>`;
    }
    return (
      `<div class="sw-head">${pinned ? "" : nav}${title}<span class="sw-loc">${where}</span>` +
      (editor ? editorAnchor(editor) : "") +
      (remote ? githubAnchor(remote.href, remote.commit, remote.what) : "") +
      modeSwitch("file", this.file !== null) +
      `<span class="sw-acts">${pin}<button class="icon" data-sw-collapse aria-label="Collapse" title="Collapse to one line (or double-click the title bar)">${COLLAPSE}</button>` +
      `<button class="icon sw-close" data-sw-close aria-label="Close" title="${pinned ? "Close (Esc)" : "Close (Esc, or Space)"}">✕</button></span></div>`
    );
  }

  /** File mode's frame: the title bar, the notes under it, and what scrolls — the sticky header and
   *  the code, with the review box under the declaration's lines; `final`: the file's own, not
   *  what stands for it while it is read. */
  private paintFile(head: string, notes: string, inner: string, final = true): void {
    const pinned = this.pinned;
    const v = this.current >= 0 ? this.g.nodes[this.current] : null;
    this.el.setAttribute("aria-label", v ? `Source of ${v.name}, the whole file${pinned ? ", pinned" : ""}` : `The file ${this.file}${pinned ? ", pinned" : ""}`);
    this.frameEl.innerHTML = `${head}${this.pairHtml()}${notes}<div class="sw-scroll">${inner}</div>`;
    const name = v ? escapeHtml(v.display ?? v.name.split(".").pop()!) : escapeHtml(this.file!.split(".").pop()!);
    this.pillEl.innerHTML =
      `<button class="sw-pill-open" type="button" title="Open ${v ? `the source of ${escapeHtml(v.name)}` : `the file ${escapeHtml(this.file!)}`} again">` +
      (v ? `<span class="dot ${kindDot(v.kind, this.g.isExt(this.current))}"></span>` : `<span class="sw-glyph">${FILE_GLYPH}</span>`) +
      `<span class="sw-pill-name">${name}</span>${pinned ? `<span class="sw-pinned" aria-label="Pinned">${PIN}</span>` : ""}</button>` +
      `<button class="icon sw-close" data-sw-close aria-label="Close" title="Close">✕</button>`;
    if (final) this.drew();
  }

  /** File mode (ReviewSpec, "The source window", the owner's decisions of 2026-11-01): the whole
   *  file the window's declaration is in — a file window's, the file it was opened on — as the graph
   *  was read from it, as it is now under the warning where it changed since, or as a past build
   *  compiled it. The declaration is highlighted and scrolled to as the window opens or switches
   *  mode; each declaration has its mark in the gutter; the review box is the declaration's, under
   *  its lines; a sticky header names the declaration the reading position is in. A step to another
   *  declaration of the same text moves only what is the declaration's, the reader's place staying. */
  private async renderFile(fresh: boolean): Promise<void> {
    const g = this.g;
    const i = this.current;
    const v = i >= 0 ? g.nodes[i] : null;
    const module = this.file ?? v?.module;
    if (!module) return;
    const turn = ++this.turn;
    this.hideTip();
    this.unpick();
    const past = this.hooks.pastOf(g);
    this.still = !!past;
    this.era = past ? "then" : "now";
    this.el.classList.add("sw-file-mode");
    this.el.classList.toggle("sw-folds", this.hooks.foldProofs());
    const before = this.whole;
    const scroll = this.el.querySelector<HTMLElement>(".sw-scroll");
    const keep = !this.scrollWanted && before?.module === module && scroll ? scroll.scrollTop : null;
    if (fresh && !(before && before.module === module && before.g === g)) this.awaitCode(turn, () => this.paintFile(this.fileHead(escapeHtml(module), null, null), "", `<div class="sw-body"><div class="sw-none">Reading the file…</div></div>`, false));
    // the text: the build's of a past board (HistorySpec decision 23), else the file's now
    let text: string, file: string, hash = "", edited = false, out: OutsideWhere | undefined;
    let passRead: (j: number) => boolean = () => false;
    const notes: string[] = [];
    // GitHub's link to lines of the text on show, where it is a commit's (DeploySpec decision 13)
    let remoteFor: (from: number, to: number) => Remote | null = () => null;
    const nowhere = (where: string, note: string, why: string) => {
      this.leaveFile();
      this.paintFile(this.fileHead(escapeHtml(where), null, null), note, `<div class="sw-body"><div class="sw-none">${why}</div></div>${v ? `<div class="sw-review">${this.box.html(i)}</div>` : ""}`);
      this.attachInfo(null);
      this.box.reveal(this.el);
    };
    if (past) {
      const got = await this.data.pastSource(past.past.snapshot.id, module);
      if (turn !== this.turn) return;
      const commit = past.past.snapshot.commit?.hash ?? null;
      if ("missing" in got) {
        const why = got.why ? `: ${escapeHtml(got.why)}` : "";
        return nowhere(got.file || module, `<div class="banner sw-then">As built ${escapeHtml(past.when)}${commit ? ` · <code>${escapeHtml(commit.slice(0, 7))}</code>` : ""}</div>`, `This file at this build ${got.outside ? "was" : "is"} not kept${why}.`);
      }
      ({ text, file, outside: out } = got);
      notes.push(`<div class="banner sw-then">${escapeHtml(pastNote(past.when, commit, got.check, got.outside))}</div>`);
      // the text kept is that commit's own: the build read from a clean checkout of it; outside the
      // project, the package's at the revision it had then, which it has now
      const pc = past.past.snapshot.commit;
      const o = out;
      remoteFor = (from, to) => {
        const href = o?.github ? outsideLink(o, from, to) : !o && pc && !pc.dirty && !pc.guessed && (got.from === "tree" || got.from === `git:${pc.hash}`) ? this.hooks.githubLink?.(file, pc.hash, from, to) : null;
        return href ? (o?.github ? { href, commit: o.github.rev, what: packageWords(o) } : { href, commit: pc!.hash }) : null;
      };
    } else {
      const src = await this.data.source(module);
      if (turn !== this.turn) return;
      if (!src) return nowhere(module, "", this.file === null && v && g.isExt(i) ? "A declaration from outside the project: its source is not found here." : "The file could not be read.");
      ({ text, file, outside: out } = src);
      hash = src.hash ?? "";
      const compiled = this.hooks.compiledOf(module);
      edited = out ? !!out.changed : !!compiled && !!src.hash && compiled !== src.hash;
      const o = out, e = edited, at = file;
      remoteFor = (from, to) => this.nowRemote(at, o, e, from, to);
      // the usage pass read this very text: where it found proofs inside definitions holds in it
      passRead = (j) => !edited && !!src.hash && src.contexts?.hash === src.hash && Object.hasOwn(src.contexts.decls, g.nodes[j].name);
      const f = this.hooks.fileOf(module);
      if (f && (f.state === "failed" || f.state === "unbuilt")) notes.push(`<div class="banner bad">The last build of this file failed: the graph shows it as it was last compiled.</div>`);
      if (edited && out)
        notes.push(`<div class="banner warn">${escapeHtml(out.core ? "The toolchain" : out.package)} is at another revision than when the graph was read (${escapeHtml(packageWords(out))} now). Below is its present text; the graph refers to what was read then, and no declaration's mark is shown.</div>`);
      else if (edited)
        notes.push(`<div class="banner warn">This file has changed since it was compiled. Below is its present text; the statements, the TCBs and the review refer to the compiled version, and a declaration's mark shows only where its text is still the one compiled.</div>`);
    }
    const place = (out ? `${packageWords(out)} · ` : "") + file;
    // the same text drawn already, on the same graph: only what is the declaration's moves
    if (before && before.g === g && before.module === module && before.text === text && before.era === this.era && this.el.querySelector(".sw-file")) {
      this.whole = before;
      this.placeOwn(fresh, notes, place, edited, remoteFor, out);
      return;
    }
    const lines = text.split("\n");
    const decls = fileDecls(g, module, lines, edited);
    const chunks = chunksOf(decls, lines.length);
    const spaces = namespacesOf(g);
    const scopes = scopesAt(lines, chunks.map((c) => c.start), (n) => spaces.has(n));
    // each piece is written for the first declaration starting in it, whose own name links nowhere
    let d = 0;
    const selfs = chunks.map((c) => {
      while (d < decls.length && decls[d].start < c.start) d++;
      return d < decls.length && decls[d].start <= c.end ? g.nodes[decls[d].i].name : "";
    });
    const resolvers = chunks.map((_, k) => resolver(g, selfs[k], scopes[k]));
    const folds = proofFolds(g, decls, lines, passRead);
    // a file changed since it was compiled: which declarations keep the text compiled, from the
    // text the history kept of the build; outside the project, none is known
    const compiled = edited && !out && !past ? await this.hooks.compiledText(module) : null;
    if (turn !== this.turn) return;
    if (before?.module !== module) this.openFolds.clear();
    const w: WholeFile = { g, module, text, file, hash, lines, era: this.era, edited, decls, chunks, selfs, resolvers, folds, marks: [], compiled };
    this.whole = w;
    this.marksOf(w);
    const own = this.ownDecl();
    const ownAt = own ? chunkAt(chunks, own.start) : -1;
    const review = v ? `<div class="sw-review">${this.box.html(i)}</div>` : "";
    if (v && !own) notes.push(notThere(v, this.era));
    const body = chunks.map((_, k) => this.pieceHtml(k) + (k === ownAt ? review : "")).join("");
    this.paintFile(
      this.fileHead(this.fileWhere(place, edited), this.ownEditor(edited), remoteFor(...this.ownLines())),
      notes.join(""),
      `<div class="sw-sticky"><span class="sw-at-slot"></span>${this.foldsButton()}</div>` +
        `<div class="sw-split"><div class="sw-body sw-file">${own || !v ? "" : review}${body}</div><aside class="sw-info" hidden></aside></div>`,
    );
    this.code = { file, start: 0, lines };
    this.resolve = null;
    this.shown = { module, start: 0, hash };
    // the InfoView, about the whole file: Lean's goals anywhere in it, by the rules of Declaration
    // mode (ReviewSpec, "The InfoView")
    this.attachInfo(this.fileInfo(w, past !== null, out));
    // Lean starts on the file now, so that the first hover finds it elaborated
    if (fresh && !this.still && hash) this.data.hoverOpen(module);
    // what is on the screen as it opens drawn now, the rest as it comes near
    this.fillAround(own ? own.start : 0);
    this.watchPieces(w);
    const sc = this.el.querySelector<HTMLElement>(".sw-scroll");
    if (sc && keep !== null) sc.scrollTop = keep;
    if (this.scrollWanted || fresh) this.scrollToOwn();
    this.scrollWanted = false;
    this.updateSticky();
    this.box.reveal(this.el);
    this.flashLines();
  }

  /** The InfoView's code in File mode: the whole file from its first line; why Lean is not asked
   *  about it, as in Declaration mode — a past build's, a snapshot's, a text changed since it was
   *  compiled. */
  private fileInfo(w: WholeFile, past: boolean, out: OutsideWhere | undefined): InfoCode {
    const off = past
      ? "A past build has no InfoView: Lean knows only the latest build. Its goals are there, in the window of the board of now."
      : this.data.snapshot
        ? "A snapshot of the page has no InfoView: there is no Lean in it. The server's page shows the goals."
        : w.edited && out
          ? `${out.core ? "The toolchain" : out.package} is at another revision than when the graph was read: its goals would be another text's than Lean checked.`
          : w.edited
            ? "This file has changed since it was compiled: its goals would be the present text's, not what Lean checked. They come back once it is compiled again."
            : !w.hash
              ? "Lean cannot be asked about this file here."
              : null;
    return { module: w.module, start: 0, text: w.text, hash: w.hash, off };
  }

  /** Where File mode's file is, as the title bar says it: the file, the declaration's lines in it. */
  private fileWhere(place: string, edited: boolean): string {
    const own = this.ownDecl();
    return `${escapeHtml(place)}${own ? `:${own.start + 1}–${own.end + 1}` : ""}${edited ? " · present text" : ""}`;
  }

  /** The editor's link to the window's declaration in File mode, as in Declaration mode; none for a
   *  file window or a past build. */
  private ownEditor(edited: boolean): string | null {
    const own = this.ownDecl();
    if (this.still || this.current < 0) return null;
    return this.hooks.editorLink(this.g, this.current, edited && own ? { line: own.start + 1, col: 1 } : undefined);
  }

  /** GitHub's link to lines `from`–`to` of the file of now (DeploySpec decision 13): at the build's
   *  commit, outside the project in its package at its revision; none for a text changed since. */
  private nowRemote(file: string, out: OutsideWhere | undefined, edited: boolean, from: number, to: number): Remote | null {
    if (edited) return null;
    if (out) {
      const href = outsideLink(out, from, to);
      return href && out.github ? { href, commit: out.github.rev, what: packageWords(out) } : null;
    }
    const built = this.hooks.builtCommit?.();
    const href = built ? this.hooks.githubLink?.(file, built, from, to) : null;
    return href && built ? { href, commit: built } : null;
  }

  /** The window's declaration's lines (from 1), what GitHub's link shows; a file window's first. */
  private ownLines(): [number, number] {
    const own = this.ownDecl();
    return own ? [own.start + 1, own.end + 1] : [1, 1];
  }

  /** The window's declaration among the file's, where it is in this text; null for a file window,
   *  or one not found. */
  private ownDecl(): FileDecl | null {
    const w = this.whole;
    if (!w || this.current < 0) return null;
    const d = w.decls.find((x) => x.i === this.current);
    if (d) return d;
    // one Lean generated from a command, which is not the file's own: its command's lines, as
    // Declaration mode shows them
    const v = w.g.nodes[this.current];
    if (v.gen === undefined || !v.range || v.module !== w.module) return null;
    const at = excerptOf(w.lines, w.edited, v.name, v.range);
    return at ? { i: this.current, start: at.start, end: at.end, head: at.start } : null;
  }

  /** The window stepped to another declaration of the text on show (the selection followed, the
   *  sticky header pressed), or drawn again: the title bar and the notes are the new declaration's,
   *  its lines are highlighted, the review box goes under them; the reader's place stays, scrolled
   *  to the declaration only where none of it is in sight. */
  private placeOwn(fresh: boolean, notes: string[], place: string, edited: boolean, remoteFor: (from: number, to: number) => Remote | null, out: OutsideWhere | undefined): void {
    const w = this.whole!;
    const v = this.current >= 0 ? this.g.nodes[this.current] : null;
    const own = this.ownDecl();
    if (v && !own) notes.push(notThere(v, this.era));
    const headEl = this.frameEl.querySelector(".sw-head");
    if (headEl) headEl.outerHTML = this.fileHead(this.fileWhere(place, edited), this.ownEditor(edited), remoteFor(...this.ownLines()));
    for (const b of this.frameEl.querySelectorAll(":scope > .banner")) b.remove();
    (this.frameEl.querySelector(".sw-pair") ?? this.frameEl.querySelector(".sw-head"))?.insertAdjacentHTML("afterend", notes.join(""));
    // the highlight, and the review box under the declaration's lines (atop where it is not found)
    for (const l of this.frameEl.querySelectorAll(".ln.hl")) l.classList.remove("hl");
    if (own) for (let l = own.start; l <= own.end; l++) this.lineEl(l)?.classList.add("hl");
    const body = this.frameEl.querySelector<HTMLElement>(".sw-file");
    let r = this.frameEl.querySelector<HTMLElement>(".sw-review");
    if (!v) r?.remove();
    // drawn again on the same declaration (the review changed, the selection followed to it again):
    // its review box drawn again where it is, a comment being written keeping its place
    else if (!fresh && r) this.redrawReview();
    else if (body) {
      if (!r) {
        r = document.createElement("div");
        r.className = "sw-review";
      }
      r.innerHTML = this.box.html(this.current);
      const at = own ? body.querySelector(`pre.src[data-piece="${chunkAt(w.chunks, own.start)}"]`) : null;
      if (at) at.after(r);
      else body.prepend(r);
    }
    this.el.setAttribute("aria-label", v ? `Source of ${v.name}, the whole file${this.pinned ? ", pinned" : ""}` : `The file ${this.file}${this.pinned ? ", pinned" : ""}`);
    this.refreshMarks();
    this.drew();
    this.code = { file: w.file, start: 0, lines: w.lines };
    this.shown = { module: w.module, start: 0, hash: w.hash };
    this.attachInfo(this.fileInfo(w, w.era === "then", out));
    if (this.scrollWanted || (fresh && !this.ownInSight())) this.scrollToOwn();
    this.scrollWanted = false;
    this.updateSticky();
    this.box.reveal(this.el);
    this.flashLines();
  }

  /** Piece `k` of the file on show as a code block of its own, empty until it comes near the screen
   *  (`fill`), standing meanwhile as tall as its lines would be unwrapped: a file of thousands of
   *  lines is highlighted and laid out where it is read, not all at once. */
  private pieceHtml(k: number): string {
    const w = this.whole!;
    const c = w.chunks[k];
    const h = Math.round((c.end - c.start + 1) * LINE_H);
    return `<pre class="code src sw-piece" data-line="${c.start}" data-end="${c.end}" data-piece="${k}" style="--gw:${gutterDigits(w.lines.length)};height:${h}px;contain-intrinsic-block-size:auto ${h}px"></pre>`;
  }

  /** A piece drawn, where it is not yet: its lines highlighted, the names in them linked (as Lean
   *  said, where it was asked), the window's declaration's lines highlighted, a declaration's mark
   *  where its command starts, its proofs marked to fold, those opened one by one open. Laid out
   *  only near the screen after that (web/style.css). */
  private fill(pre: HTMLElement): void {
    if (pre.dataset.end === undefined || !this.whole) return;
    delete pre.dataset.end;
    pre.innerHTML = this.pieceLines(Number(pre.dataset.piece));
    pre.style.height = "";
    this.applyOpen(pre);
    // the caret's line, where it is in this piece
    const k = this.info.caret;
    if (k && k.line >= Number(pre.dataset.line) && k.line < Number(pre.dataset.line) + pre.children.length) this.info.marks();
  }

  /** The pieces of the file around line `line` drawn at once, `n` lines either way: what is on the
   *  screen as the window opens on it, before the pieces coming near are drawn as they come. */
  private fillAround(line: number, n = 120): void {
    for (const pre of this.el.querySelectorAll<HTMLElement>("pre.sw-piece[data-end]")) {
      const from = Number(pre.dataset.line), to = Number(pre.dataset.end);
      if (to >= line - n && from <= line + n) this.fill(pre);
    }
  }

  private pieceLines(k: number): string {
    const w = this.whole!;
    const c = w.chunks[k];
    const lines = w.lines.slice(c.start, c.end + 1);
    const text = lines.join("\n");
    const known = this.still ? undefined : this.memory.learned.get(`${w.module}:${w.hash}:${c.start}-${c.end}`);
    const resolve = w.resolvers[k];
    const own = this.ownDecl();
    // the declarations whose command starts in it: their marks
    const heads = new Map<number, number>();
    w.decls.forEach((fd, d) => {
      if (fd.head >= c.start && fd.head <= c.end && !heads.has(fd.head)) heads.set(fd.head, d);
    });
    const starts = [0];
    for (const l of lines) starts.push(starts[starts.length - 1] + l.length + 1);
    const off = ([line, col]: [number, number]) => starts[Math.max(0, Math.min(lines.length, line - c.start))] + col;
    const folds = w.folds.filter((f) => f.from[0] >= c.start && f.from[0] <= c.end).map((f) => ({ from: off(f.from), to: Math.min(text.length, off(f.to)), id: `${f.from[0]}:${f.from[1]}` }));
    const decor: LineDecor = {
      line: (j) => {
        const l = c.start + j;
        const hl = !!own && l >= own.start && l <= own.end;
        const d = heads.get(l);
        const lead = d === undefined ? "" : this.markHtml(d);
        return hl || lead ? { cls: hl ? " hl" : "", lead } : undefined;
      },
      folds,
    };
    return highlightLines(text, (word, at) => (known?.has(at) ? known.get(at) : resolve(word)), c.start + 1, decor);
  }

  /** Declaration `d`'s mark in the gutter, where its command starts: its review state in the Status
   *  scheme's colours, with its name and state as its tooltip; nothing where none is shown. No
   *  text: the code's text stays the source's. */
  private markHtml(d: number): string {
    const w = this.whole!;
    const m = w.marks[d];
    if (!m) return "";
    const v = w.g.nodes[w.decls[d].i];
    return `<span class="dm s-${m}" data-dm="${d}" aria-hidden="true" title="${escapeHtml(`${v.name}: ${FILE_MARK_LABEL[m]}`)}"></span>`;
  }

  /** Each declaration's mark, from the review as it is now: shown only where the text is the one
   *  compiled, which the review is about (a file changed since: where its text is still that). */
  private marksOf(w: WholeFile): void {
    const d = this.hooks.review(w.g);
    const inReview = this.hooks.inReview(w.g);
    w.marks = w.decls.map((fd) => {
      const r = w.g.nodes[fd.i].range;
      if (w.edited && !(w.compiled && r && sameText(w.compiled, r, w.lines, fd))) return null;
      return fileMark(d, w.g, fd.i, inReview);
    });
  }

  /** The review changed: the marks again, where they are drawn, and the sticky header's. */
  private refreshMarks(): void {
    const w = this.whole;
    if (!w) return;
    this.marksOf(w);
    for (const el of this.frameEl.querySelectorAll<HTMLElement>(".dm[data-dm]")) {
      const d = Number(el.dataset.dm);
      const m = w.marks[d];
      if (!m) {
        el.remove();
        continue;
      }
      el.className = `dm s-${m}`;
      el.title = `${w.g.nodes[w.decls[d].i].name}: ${FILE_MARK_LABEL[m]}`;
    }
    this.stickyAt = null;
    this.updateSticky();
  }

  /** "Fold proofs", in the sticky header: the reader's own, remembered in this browser. */
  private foldsButton(): string {
    const on = this.hooks.foldProofs();
    return `<button type="button" class="sw-folds-btn" data-sw-folds aria-pressed="${on}" title="${on ? "Show every proof again" : "Fold every proof to one line, ⋯ proof: a click on one shows it"} (in every window, in this browser)">Fold proofs</button>`;
  }

  /** Proofs folded or shown, the reader's choice, in every window of the page (the page tells each,
   *  `refold`). */
  private foldProofs(on: boolean): void {
    this.hooks.setFoldProofs(on);
  }

  /** Proofs folded or shown as the reader chose: the place in the file stays where it was read. */
  refold(): void {
    if (this.mode !== "file") return;
    const on = this.hooks.foldProofs();
    if (on) this.openFolds.clear();
    this.keepPlace(() => {
      this.el.classList.toggle("sw-folds", on);
      for (const el of this.el.querySelectorAll(".pf-open")) el.classList.remove("pf-open");
      this.applyOpen();
    });
    const b = this.el.querySelector<HTMLElement>("[data-sw-folds]");
    if (b) b.outerHTML = this.foldsButton();
    this.updateSticky();
  }

  /** A folded proof opened: that one alone, its place staying. */
  private openFold(id: string): void {
    this.openFolds.add(id);
    this.keepPlace(() => this.applyOpen());
  }

  /** The proofs opened one by one shown, in the code as drawn now. */
  private applyOpen(root: ParentNode = this.frameEl): void {
    for (const id of this.openFolds) for (const el of root.querySelectorAll(`[data-pf="${CSS.escape(id)}"], [data-pf-open="${CSS.escape(id)}"]`)) el.classList.add("pf-open");
  }

  /** Do `change` to what is drawn, the line read at the top of the code staying where it was. */
  private keepPlace(change: () => void): void {
    const sc = this.el.querySelector<HTMLElement>(".sw-scroll");
    const top = sc ? this.topLine() : null;
    const el = top ? (this.lineEl(top.line) ?? null) : null;
    const was = el?.getBoundingClientRect().top ?? null;
    change();
    if (!sc || !el || was === null) return;
    // a line now folded away: its block stands for it
    const now = (el.getClientRects().length ? el : el.parentElement!).getBoundingClientRect().top;
    sc.scrollTop += now - was;
  }

  /** The line of the file at the top of the code, under the sticky header, and the element there;
   *  null where nothing is. */
  private topLine(): { line: number; inReview: boolean } | null {
    const sc = this.el.querySelector<HTMLElement>(".sw-scroll");
    const body = this.el.querySelector<HTMLElement>(".sw-file");
    if (!sc || !body) return null;
    const r = sc.getBoundingClientRect();
    const y = r.top + (sc.querySelector<HTMLElement>(".sw-sticky")?.offsetHeight ?? 0) + LINE_H * 0.75;
    const x = body.getBoundingClientRect().left + 24;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !this.el.contains(hit)) return null;
    if (hit.closest(".sw-review")) {
      const own = this.ownDecl();
      return own ? { line: own.end, inReview: true } : null;
    }
    const ln = hit.closest<HTMLElement>(".ln");
    const pre = (ln?.parentElement ?? hit.closest("pre.src")) as HTMLElement | null;
    if (!pre?.matches("pre.src")) return null;
    return { line: Number(pre.dataset.line ?? 0) + (ln ? Array.prototype.indexOf.call(pre.children, ln) : 0), inReview: false };
  }

  /** what the sticky header names, as last drawn */
  private stickyAt: string | null = null;

  private stickyLater(): void {
    if (this.mode !== "file" || this.stickyWait) return;
    this.stickyWait = requestAnimationFrame(() => {
      this.stickyWait = 0;
      this.updateSticky();
    });
  }

  /** The sticky header: the declaration the reading position is in, with its state — pressed, it is
   *  selected (the owner's decision of 2026-11-01: scrolling never selects) —, or the file between
   *  declarations. */
  private updateSticky(): void {
    const w = this.whole;
    const slot = this.el.querySelector<HTMLElement>(".sw-at-slot");
    if (!w || !slot) return;
    const top = this.topLine();
    const fd = top ? declAt(w.decls, top.line) : null;
    const d = fd ? w.decls.indexOf(fd) : -1;
    const key = fd ? `${fd.i}:${w.marks[d] ?? ""}:${fd.i === this.current}` : `-${w.file}`;
    if (key === this.stickyAt) return;
    this.stickyAt = key;
    if (!fd) {
      slot.innerHTML = `<span class="sw-at-file">${escapeHtml(w.file)}</span>`;
      return;
    }
    const v = w.g.nodes[fd.i];
    const m = w.marks[d];
    const short = v.display ?? v.name.split(".").pop()!;
    slot.innerHTML =
      `<button type="button" class="sw-at" data-sw-at="${escapeHtml(v.name)}" title="${escapeHtml(fd.i === this.current ? `${v.name}: on show in this window` : `Select ${v.name}`)}">` +
      `${m ? `<span class="dm s-${m}" aria-hidden="true"></span>` : ""}<span class="sw-at-name">${escapeHtml(short)}</span>` +
      `<span class="sw-at-st">${m ? escapeHtml(FILE_MARK_LABEL[m]) : ""}</span></button>`;
  }

  /** Scrolled to the window's declaration, under the sticky header; a file window, to its top. */
  private scrollToOwn(): void {
    const sc = this.el.querySelector<HTMLElement>(".sw-scroll");
    if (!sc) return;
    const own = this.ownDecl();
    if (!own) {
      if (this.file !== null) sc.scrollTop = 0;
      return;
    }
    const go = () => {
      const el = this.lineEl(own.start);
      if (!el) return;
      const sticky = sc.querySelector<HTMLElement>(".sw-sticky")?.offsetHeight ?? 0;
      sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - sticky - 10;
    };
    go();
    // the pieces around it, laid out as they come into sight, may stand otherwise than estimated
    requestAnimationFrame(() => {
      go();
      this.updateSticky();
    });
  }

  /** Whether some of the window's declaration's lines are in sight. */
  private ownInSight(): boolean {
    const sc = this.el.querySelector<HTMLElement>(".sw-scroll");
    const own = this.ownDecl();
    const a = own && this.lineEl(own.start), b = own && this.lineEl(own.end);
    if (!sc || !a || !b) return false;
    const r = sc.getBoundingClientRect();
    return a.getBoundingClientRect().top < r.bottom && b.getBoundingClientRect().bottom > r.top + (sc.querySelector<HTMLElement>(".sw-sticky")?.offsetHeight ?? 0);
  }

  /** Lean asked what the names of each piece mean as it comes into sight (or near it), once per
   *  text: a file's thousands of names are not asked at once. */
  private watchPieces(w: WholeFile): void {
    this.seen?.disconnect();
    this.seen = null;
    const sc = this.el.querySelector<HTMLElement>(".sw-scroll");
    if (!sc) return;
    const learn = !this.still && !!w.hash;
    // without the observer (an old browser), every piece is drawn at once
    if (typeof IntersectionObserver === "undefined") return void this.fillAround(0, Infinity);
    const seen = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          if (!e.isIntersecting) continue;
          seen.unobserve(e.target);
          this.fill(e.target as HTMLElement);
          if (learn) void this.learnPiece(w, Number((e.target as HTMLElement).dataset.piece));
        }
      },
      { root: sc, rootMargin: "600px 0px" },
    );
    for (const pre of sc.querySelectorAll("pre.sw-piece")) seen.observe(pre);
    this.seen = seen;
  }

  /** What Lean says each name of piece `k` means, the piece drawn again with it. */
  private async learnPiece(w: WholeFile, k: number): Promise<void> {
    const c = w.chunks[k];
    if (!c) return;
    const key = `${w.module}:${w.hash}:${c.start}-${c.end}`;
    if (this.memory.learned.has(key)) return;
    const text = w.lines.slice(c.start, c.end + 1).join("\n");
    const words: { word: string; at: number }[] = [];
    highlightLines(text, (word, at) => (words.push({ word, at }), null));
    if (!words.length) return;
    const live = () => this.whole === w && this.mode === "file";
    await this.learn(live, w.selfs[k], key, w.module, w.hash, text, c.start, words, () => {
      const pre = this.frameEl.querySelector<HTMLElement>(`pre.sw-piece[data-piece="${k}"]`);
      if (!pre) return;
      pre.innerHTML = this.pieceLines(k);
      this.applyOpen(pre);
      this.flashLines();
      this.info.marks();
    });
  }

  /** The InfoView told the code drawn now, its element and the code's (none: no code on show). */
  private attachInfo(code: InfoCode | null): void {
    // a line of the file found as the window finds it: in Declaration mode's block, in File mode's
    // pieces (drawn as they are reached)
    this.info.attach(this.frameEl.querySelector<HTMLElement>(".sw-info"), (line) => this.lineEl(line), code);
  }

  /** The context the code on show is written in, as Lean, muted above it: folded when long to
   *  its first lines and its namespaces and sections, with the `variable`s the declaration uses
   *  marked and always shown — those Lean included in it where the context is the elaborator's
   *  (`exact`, the usage pass's), else those that seem to be (a name of theirs in its statement or
   *  its text). Each command is numbered in the gutter at the line it is written on (its first),
   *  a break before it where lines were left out, and under the last one where the code does not
   *  follow it: as the context shows whole, and folded (web/src/gutter.ts). */
  private contextHtml(lines: string[], start: number, type: string, text: string, resolve: (w: string) => string | null, exact: FileContext | null): string {
    const ctx = contextLines(readContext(lines, start, exact));
    if (!ctx.length) return "";
    const used = usedVariables(ctx, [type, text], !!exact);
    const FIRST = 3, LONG = 6;
    const long = ctx.length > LONG;
    // what is always shown: the first lines, the namespaces and sections it sits in, what it seems
    // to use, and what holds for it alone
    const kept = ctx.map((l, k) => !long || k < FIRST || l.kind === "namespace" || l.kind === "section" || l.kind === "mutual" || used.has(k) || / in$/.test(l.text));
    const gutter = contextGutter(ctx.map((l) => l.line), kept, start + 1);
    let hidden = 0;
    const rows = ctx.map((l, k) => {
      const keep = kept[k];
      if (!keep) hidden++;
      // its gutter, as the context shows whole and folded
      const marks = rowMarks(gutter.open[k], gutter.folded[k]);
      const cls = `sw-ctx-l${used.has(k) ? " used" : ""}${keep ? "" : " fold"}${marks ? ` ${marks}` : ""}`;
      const tip = !used.has(k) ? "" : exact ? ` title="Lean included this variable in the declaration"` : ` title="A name it binds occurs in this declaration: Lean may include it"`;
      return `<div class="${cls}"${tip}>${highlightLines(l.text, (w) => resolve(w), l.line > 0 ? l.line : undefined)}</div>`;
    });
    const more = hidden ? `${hidden} more` : "";
    const cut = cutMarks(gutter.cut);
    return (
      `<div class="sw-ctx${this.ctxOpen ? " open" : ""}${exact ? " exact" : ""}${cut ? ` ${cut}` : ""}" style="--gw:${gutterDigits(start + text.split("\n").length)}" aria-label="The context it is written in" title="${exact ? "The context as Lean elaborated it" : "The context, read from the file's text"}">` +
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
    live: () => boolean,
    self: string,
    key: string,
    module: string,
    hash: string,
    text: string,
    start: number,
    words: { word: string; at: number }[],
    apply: (learned: Map<number, RefAnswer>) => void,
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
    // at most what the server takes at once (server/appgraph.ts): the names past it keep the page's
    // reading
    if (positions.length > NAMES_MAX) {
      positions.length = NAMES_MAX;
      parts.length = NAMES_MAX;
    }
    let heads: (string | null)[] | undefined;
    for (let tries = 0; tries < 120 && !heads; tries++) {
      const res = await this.data.names(module, positions, hash);
      if (!live() || !res || res.stale || res.error) return;
      if (res.pending) await new Promise((ok) => setTimeout(ok, 1000));
      else heads = res.heads;
    }
    if (!heads || !live()) return;
    const byWord = new Map<number, (string | null)[]>();
    parts.forEach((p, k) => {
      const segs = byWord.get(p.word) ?? [];
      segs.push(heads![k] ?? null);
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
    // a file's pieces each have theirs: room for a few files
    if (this.memory.learned.size > 256) this.memory.learned.delete(this.memory.learned.keys().next().value!);
    if (live()) apply(learned);
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

/** The code on show as the window draws it: its lines highlighted (`lines`, highlightLines from the
 *  line after `start`, from 0, where `text` starts in its file), the gutter holding room for the
 *  digits of its last line's number. */
function codeHtml(lines: string, start: number, text: string): string {
  return `<pre class="code src" data-line="${start}" style="--gw:${gutterDigits(start + text.split("\n").length)}">${lines}</pre>`;
}

/** "Open on GitHub" (DeploySpec decision 13): the declaration's lines in the build's commit, in a
 *  tab of its own; outside the project, in its package's repository at the revision shown (`what`:
 *  the package and its revision in words). */
function githubAnchor(href: string, commit: string, what?: string): string {
  const title = what ? `These lines of ${what}, on GitHub` : `These lines at ${commit.slice(0, 7)}, the commit of the build shown, on GitHub`;
  return `<a class="link editor-link gh-link" href="${escapeHtml(href)}" target="_blank" rel="noopener" title="${escapeHtml(title)}">Open on GitHub</a>`;
}
