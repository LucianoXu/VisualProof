// The guide (CollabSpec, stage G1): on a reader's first visit, a short tour of the page that lights
// up one part at a time on the project itself — a real theorem selected, its TCB on the canvas —
// and, at any time, a sheet of every key and gesture (the ? button, or ?) that can replay it.
//
// The sheet also holds the one setting that is about the reader's machine rather than the page:
// the URL that opens a declaration in their editor (web/src/editor.ts). It sits with the keys
// because both are read once and then left alone, and the sheet is where a reader looks for how
// the page works with what they have. At its foot is what the graph holds.

import { dragKeyName, MAC } from "./drag.ts";
import { escapeHtml } from "./highlight.ts";
import type { Store } from "./store.ts";
import { typing } from "./typing.ts";

export interface GuideHooks {
  /** the project's name */
  project(): string;
  /** the project as read, in a sentence: how much the graph holds, when and how it was read */
  about(): string;
  /** a snapshot: no names, no others, no timeline */
  snapshot(): boolean;
  /** the declaration the tour shows things on: the selection, a target, or a theorem with a
   *  modest TCB; null when there is none */
  example(): number | null;
  /** select it, as a click would, and bring it into view */
  select(i: number): void;
  /** the tour ended (done or skipped) */
  ended(): void;
  /** the "Open in editor" templates: the server's, and the reader's own */
  editor(): { server: string | null; mine: string | null };
  /** set the reader's own template ("" goes back to the server's); why not, when refused */
  setEditor(t: string): string | null;
}

interface Step {
  title: string;
  text: string;
  /** what to light up: elements, or a rectangle; nothing for a step in the middle of the screen */
  at?: () => DOMRect | null;
  /** done before the step shows */
  before?: () => void;
  /** whether the step belongs in this page at all (a snapshot has no others) */
  only?: () => boolean;
  /** whether its place is shown now: a step whose place is not (the panel did not open) is
   *  passed over */
  when?: () => boolean;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);

/** The rectangle around the elements found, or null when none is shown. */
function around(...sels: string[]): DOMRect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of sels) {
    const el = $(s);
    if (!el || el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    x0 = Math.min(x0, r.left);
    y0 = Math.min(y0, r.top);
    x1 = Math.max(x1, r.right);
    y1 = Math.max(y1, r.bottom);
  }
  return isFinite(x0) ? new DOMRect(x0, y0, x1 - x0, y1 - y0) : null;
}

/** A row of the sheet: keys (drawn as keys), then a gesture in words, then what it does. */
interface Row {
  k?: string[];
  g?: string;
  what: string;
}

const KEYS: [string, Row[]][] = [
  [
    "Getting around",
    [
      { k: ["/"], what: "search names, statements and docstrings" },
      { k: ["Alt ←", "Alt →"], what: "back, forward" },
      { k: ["f"], what: "fit the view" },
      { k: ["+", "−"], what: "zoom in, out" },
      { k: ["[", "]"], what: "one level less, more" },
      { k: ["Esc"], what: "close, select nothing (the visitors, dashed, go with it)" },
      { k: ["t"], what: "the Time Machine: this view at a past build, to look at; t or Esc leaves it" },
      { k: ["←", "→"], g: "in it", what: "the build before, after (Home, End: the first, the last); or drag the timeline" },
    ],
  ],
  [
    "Selecting",
    [
      { g: "click", what: "select a declaration, or a cluster (a circle, a row of the tree)" },
      { k: ["Shift"], g: "click", what: "with Selection: add it, or take it out" },
      { k: ["1", "2", "3"], what: "how a click selects: just it, what it rests on, what uses it" },
      { k: ["2"], g: "again", what: "Rests on's next step: its TCB, the key declarations in it, everything it uses" },
      { g: "click empty space", what: "select nothing (also Esc)" },
      { k: ["Space"], what: "the selection's source, in a window that follows it" },
      { g: "the pin of a source window", what: "keep it on its declaration: the next opens beside it" },
    ],
  ],
  [
    "Reviewing",
    [
      { k: ["a"], what: "approve the selection; in a source window, its declaration" },
      { k: ["m"], what: "comment on it: write the comment, Esc, m again" },
      { k: ["k"], what: "mark it key for the focus (Focus ▾), or unmark it" },
    ],
  ],
  [
    "Showing",
    [
      { k: ["e"], what: "the outside world on this board, for everyone" },
      { k: ["g"], what: "edges, for you" },
      { k: ["c"], what: "colour by kind or by status, for you" },
      { k: ["b"], what: "build status" },
      { k: ["p"], what: "frame meter" },
      { k: ["?"], what: "this sheet" },
    ],
  ],
  [
    "With the pointer",
    [
      { g: "scroll", what: "zoom" },
      { g: "drag", what: "pan, anywhere (or with the middle button)" },
      // on a Mac, Ctrl+click is the right click: the drag key is ⌘ there (web/src/drag.ts)
      MAC ? { k: ["Ctrl"], g: "click, or right click", what: "what can be done with what is under the pointer: the menu" } : { g: "right click", what: "what can be done with what is under the pointer: the menu" },
      { k: ["Shift F10"], what: "the same menu on what is selected (or the ContextMenu key)" },
      { k: [dragKeyName()], g: "drag a dot, a circle or a note", what: "move it, for everyone on this board" },
      { k: ["l"], what: "let the lock go, or lock again: unlocked, a drag moves dots, circles and notes (the lock, behind ⋯ at the bottom right)" },
      { k: [dragKeyName()], g: "hold", what: "the other way while held: move things on a locked layout, or pan over them" },
      { g: "click a note's icon", what: "show its card, or the icon alone, for everyone on this board" },
      { g: "drag a note's card", what: "where it hangs from its icon, as a drag moves things; the note stays where it is" },
      { g: "double-click a note's card", what: "edit the note" },
      { g: "double-click a circle", what: "fold it, or open it, for everyone on this board" },
      { g: "rest on a name in the source", what: "what Lean says it is" },
      { g: "drag a window's title bar, or an edge", what: "move it, resize it; a double-click on the title bar collapses it" },
    ],
  ],
];

export class Guide {
  private store: Store;
  private hooks: GuideHooks;
  private steps: Step[] = [];
  private k = 0;
  private el: HTMLElement;
  private spot: HTMLElement;
  private shades: HTMLElement[];
  private card: HTMLElement;
  private help: HTMLElement;

  constructor(store: Store, hooks: GuideHooks) {
    this.store = store;
    this.hooks = hooks;
    this.el = $("#tour")!;
    this.spot = this.el.querySelector<HTMLElement>(".tour-spot")!;
    this.shades = [...this.el.querySelectorAll<HTMLElement>(".tour-shade")];
    this.card = this.el.querySelector<HTMLElement>(".tour-card")!;
    this.help = $("#help")!;
    this.card.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-tour-next]")) this.go(this.k + 1);
      else if (t.closest("[data-tour-back]")) this.go(this.k - 1);
      else if (t.closest("[data-tour-skip]")) this.stop();
    });
    window.addEventListener(
      "keydown",
      (e) => {
        if (this.el.hidden) return;
        // the tour has the keys while it shows
        e.stopImmediatePropagation();
        if (e.key === "Escape") this.stop();
        else if (e.key === "ArrowRight" || e.key === "Enter") this.go(this.k + 1);
        else if (e.key === "ArrowLeft") this.go(this.k - 1);
        e.preventDefault();
      },
      true,
    );
    window.addEventListener("resize", () => {
      if (!this.el.hidden) this.place();
    });
    this.help.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t === this.help || t.closest("[data-help-close]")) this.closeHelp();
      else if (t.closest("[data-help-tour]")) {
        this.closeHelp();
        this.start();
      }
    });
    this.help.addEventListener("keydown", (e) => {
      // a ? typed into the editor's field is part of a URL
      if (e.key === "Escape" || (e.key === "?" && !typing(e.target))) {
        e.stopPropagation();
        // Esc leaves the field as it was saved: it cancels, as everywhere
        const field = this.help.querySelector<HTMLInputElement>("[data-help-editor]");
        if (field) field.value = this.hooks.editor().mine ?? "";
        this.closeHelp();
      }
    });
    // the template is saved when the field is left or Enter pressed; while it is typed, an earlier
    // complaint goes away
    this.help.addEventListener("change", (e) => {
      const field = (e.target as HTMLElement).closest<HTMLInputElement>("[data-help-editor]");
      if (!field) return;
      const why = this.hooks.setEditor(field.value);
      const err = this.help.querySelector<HTMLElement>("[data-help-editor-err]")!;
      err.textContent = why ?? "";
      err.hidden = !why;
      if (!why) this.help.querySelector<HTMLElement>("[data-help-editor-now]")!.innerHTML = this.editorNow();
    });
    this.help.addEventListener("input", (e) => {
      if ((e.target as HTMLElement).closest("[data-help-editor]")) this.help.querySelector<HTMLElement>("[data-help-editor-err]")!.hidden = true;
    });
  }

  /** The first visit: the tour, once. */
  firstVisit(): void {
    if (this.store.data.guided) return;
    this.start();
  }

  get showing(): boolean {
    return !this.el.hidden || !this.help.hidden;
  }

  start(): void {
    const project = escapeHtml(this.hooks.project());
    const live = () => !this.hooks.snapshot();
    const all: Step[] = [
      {
        title: "Welcome",
        text: `${project}'s declarations as a map, and what each theorem rests on. A quick tour.`,
      },
      {
        title: "The map",
        text: `Dots are declarations, circles namespaces. Scroll to zoom, drag to pan, double-click a circle to fold it. To move things, drag with <b>${dragKeyName()}</b> held, or let the lock go (<b>l</b>).`,
        at: () => {
          const side = $("#side")?.getBoundingClientRect();
          const left = side && side.width ? side.right + 8 : 12;
          return new DOMRect(left, 108, innerWidth - left - 12, innerHeight - 108 - 48);
        },
      },
      {
        title: "Select",
        text: "Click a declaration, or a circle for all of its declarations. <b>Mode</b> is how a click selects: just it, what it <b>rests on</b> (everything it uses, its TCB, or the key declarations in it: <b>2</b> again for the next), or what uses it. Rest the pointer on a mode to read it. What you selected is listed above the panel.",
        before: () => {
          const i = this.hooks.example();
          if (i !== null) this.hooks.select(i);
        },
        at: () => around("#lightup"),
      },
      {
        title: "The board",
        text: "The left panel: the targets under review, and this board's clusters. A board is shared with everyone on it: <b>⚙ Board</b> holds what is on it (its scope, as chips), the clustering, the depth. Tabs are the views you have open; <b>Views</b> makes and lists them. Your camera and what you select are yours alone.",
        at: () => around("#side", "#tabs", ".views-wrap"),
      },
      {
        title: "The panel",
        text: "All about what you clicked last; <b>Source</b> (Space) opens the code, and the parts with a ▸ open on a click. Above it, what is selected: <b>Zoom in</b> opens a view of it.",
        at: () => around("#selbar", "#panel"),
        when: () => !!$("#panel.open"),
      },
      {
        title: "Review",
        text: live()
          ? "<b>Approve</b> or <b>Comment</b> on what you have read. <b>Mark as target</b> to track a theorem's review."
          : "Opinions as they were when this snapshot was taken.",
        at: () => around("#panel .rv"),
        when: () => !!$("#panel.open .rv"),
      },
      {
        title: "Together",
        text: "Who else is here: click one to follow. <b>Activity</b> lists what happened.",
        at: () => around("#activity-btn", "#peers", "#who"),
        only: live,
      },
      {
        title: "Colours",
        text: "By kind, or by <b>status</b>: what reviewers said, what is trusted, what failed to build. The legend at the bottom left switches them (or <b>c</b>) and says what each colour means.",
        at: () => around("#legend"),
      },
      {
        title: "Getting around",
        text: "Back, forward and links work as in a browser. <b>/</b> searches names, statements and docstrings; <b>?</b> lists every key.",
        at: () => around(".brand .nav", ".search-wrap", "#help-btn"),
      },
    ];
    this.steps = all.filter((s) => !s.only || s.only());
    this.k = 0;
    this.el.hidden = false;
    this.go(0);
  }

  private go(k: number, dir = k >= this.k ? 1 : -1): void {
    if (k < 0) return;
    if (k >= this.steps.length) return this.stop();
    const s = this.steps[k];
    s.before?.();
    // a step whose place is not shown (the panel did not open) is passed over, either way
    if (s.when && !s.when()) return this.go(k + dir, dir);
    this.k = k;
    const last = k === this.steps.length - 1;
    this.card.innerHTML =
      `<div class="tour-step">${k + 1} of ${this.steps.length}</div>` +
      `<div class="tour-title">${s.title}</div><div class="tour-text">${s.text}</div>` +
      `<div class="tour-actions"><button class="rv-btn" data-tour-skip>${last ? "Close" : "Skip"}</button><span class="tour-gap"></span>` +
      (k > 0 ? `<button class="rv-btn" data-tour-back>Back</button>` : "") +
      `<button class="rv-btn primary" data-tour-next>${k === 0 ? "Show me" : last ? "Done" : "Next"}</button></div>`;
    // the panel slides in: place again once it has
    this.place();
    setTimeout(() => this.place(), 360);
    this.card.querySelector<HTMLElement>("[data-tour-next]")?.focus();
  }

  /** Light up the step's place and put the card beside it, where there is room. */
  private place(): void {
    const s = this.steps[this.k];
    if (!s) return;
    const r = s.at?.() ?? null;
    const pad = 6;
    const card = this.card;
    const w = card.offsetWidth, h = card.offsetHeight;
    this.spot.classList.toggle("none", !r);
    // the hole the shade leaves: the place, with a little room; nothing for a step in the middle
    const W = innerWidth, H = innerHeight;
    const hole = r ? { l: r.left - pad, t: r.top - pad, r: r.right + pad, b: r.bottom + pad } : { l: W / 2, t: H / 2, r: W / 2, b: H / 2 };
    const rect = (el: HTMLElement, l: number, t: number, w2: number, h2: number) =>
      Object.assign(el.style, { left: `${l}px`, top: `${t}px`, width: `${Math.max(0, w2)}px`, height: `${Math.max(0, h2)}px` });
    rect(this.shades[0], 0, 0, W, hole.t);
    rect(this.shades[1], 0, hole.b, W, H - hole.b);
    rect(this.shades[2], 0, hole.t, hole.l, hole.b - hole.t);
    rect(this.shades[3], hole.r, hole.t, W - hole.r, hole.b - hole.t);
    rect(this.spot, hole.l, hole.t, hole.r - hole.l, hole.b - hole.t);
    if (!r) {
      card.style.transform = `translate(${Math.round((innerWidth - w) / 2)}px, ${Math.round((innerHeight - h) / 2)}px)`;
      return;
    }
    const gap = 14;
    const room = { below: innerHeight - r.bottom, above: r.top, right: innerWidth - r.right, left: r.left };
    let x: number, y: number;
    if (room.below >= h + gap + pad) [x, y] = [r.left, r.bottom + gap + pad];
    else if (room.above >= h + gap + pad) [x, y] = [r.left, r.top - h - gap - pad];
    else if (room.left >= w + gap + pad) [x, y] = [r.left - w - gap - pad, r.top];
    else if (room.right >= w + gap + pad) [x, y] = [r.right + gap + pad, r.top];
    // a large place (the map): the card inside it, near its top left
    else [x, y] = [r.left + 24, r.top + 24];
    x = Math.max(12, Math.min(x, innerWidth - w - 12));
    y = Math.max(12, Math.min(y, innerHeight - h - 12));
    card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  stop(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.store.data.guided = true;
    this.store.save();
    this.hooks.ended();
  }

  // ---------------------------------------------------------------- the sheet

  /** What the editor link is now, in a sentence. */
  private editorNow(): string {
    const { server, mine } = this.hooks.editor();
    const code = (t: string) => `<code>${escapeHtml(t)}</code>`;
    if (mine) return `Yours, kept in this browser. Leave the field empty ${server ? `to use the server's: ${code(server)}` : "for no link"}.`;
    if (server) return `The server's. Yours, if you set one here, is kept in this browser and goes first.`;
    return (
      `None is set, so there is no link. VS Code on the server's machine: ${code("vscode://file/{path}:{line}:{col}")}; ` +
      `over SSH: ${code("vscode://vscode-remote/ssh-remote+HOST{path}:{line}")}.`
    );
  }

  openHelp(): void {
    const { server, mine } = this.hooks.editor();
    this.help.innerHTML =
      `<div class="modal-box glass help-box" role="dialog" aria-label="Keys and gestures" tabindex="-1">` +
      `<div class="help-head"><div class="modal-title">Keys and gestures</div><button class="icon" data-help-close title="Close (Esc)">✕</button></div>` +
      `<div class="help-grid">${KEYS.map(
        ([group, rows]) =>
          `<div class="help-group"><div class="help-h">${group}</div>${rows
            .map(
              (r) =>
                `<div class="help-row"><span class="help-k">${(r.k ?? []).map((x) => `<kbd>${escapeHtml(x)}</kbd>`).join(" ")}${r.k && r.g ? " " : ""}${r.g ? `<span class="help-g">${escapeHtml(r.g)}</span>` : ""}</span><span>${escapeHtml(r.what)}</span></div>`,
            )
            .join("")}</div>`,
      ).join("")}</div>` +
      `<div class="help-editor"><div class="help-h">Open in editor</div>` +
      `<div class="help-note">A link from the panel and the source window to the declaration in your editor. ` +
      `<code>{path}</code> is the file on the server, <code>{rel}</code> the file in the project, <code>{line}</code> and <code>{col}</code> where it starts.</div>` +
      `<input class="help-input" data-help-editor value="${escapeHtml(mine ?? "")}" placeholder="${escapeHtml(server ?? "vscode://file/{path}:{line}:{col}")}" spellcheck="false" autocomplete="off" aria-label="Open in editor: URL template">` +
      `<div class="modal-err" data-help-editor-err hidden></div>` +
      `<div class="help-note" data-help-editor-now>${this.editorNow()}</div></div>` +
      `<div class="help-about"><div class="help-h">About ${escapeHtml(this.hooks.project())}</div>` +
      `<div class="help-note">${escapeHtml(this.hooks.about())}</div></div>` +
      `<div class="modal-actions"><button class="rv-btn" data-help-tour>Take the tour again</button><button class="rv-btn primary" data-help-close>Close</button></div></div>`;
    this.help.hidden = false;
    this.help.querySelector<HTMLElement>(".help-box")?.focus();
  }

  closeHelp(): void {
    // the editor's field lets go of the focus now, not at the next frame: a key pressed right after
    // Esc is a shortcut again, not text typed into a field no one sees
    if (this.help.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.help.hidden = true;
  }

  toggleHelp(): void {
    if (this.help.hidden) this.openHelp();
    else this.closeHelp();
  }
}
