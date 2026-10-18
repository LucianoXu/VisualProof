// The references on the page (AttachmentSpec decisions 5–9): the library (web/src/library.ts) and
// the reference window (web/src/paperwin.ts), and what ties them to the rest of the page — the links
// a declaration's or a cluster's panel lists, the pairing of the reference window with a source
// window, and the window's state as presence carries it. web/src/main.ts makes one, and calls it
// where the page changes: the panel drawn, a source window opened or stepping, the review changing,
// a followed reader moving.
//
// What notes carry (decision 12) opens here too: a click on a note's clip opens the reference window
// at its page, the region lit; a whole paper or an image opens as it is. A note's "Attach…" chooses a
// file of the library: an image is attached at once, a paper opens to be attached whole or by a clip.
//
// The pairing (decision 8, the owner's of 2026-10-10: "this reduces friction"): opening a
// declaration's source, and every step the source window takes to another declaration, opens its
// first link beside it at the linked place, the others offered in the window; a declaration with no
// link of its own shows the link of the innermost cluster around it that has one, under the board's
// clustering, and says whose it is; with none, the window says so and keeps what it showed. It pairs
// with whichever source window the reader last opened or stepped, pinned or not, and the two stand
// side by side (the owner's decisions of 2026-10-11; web/src/paperdock.ts). Whenever the pairing
// opens or shows the reference window beside a source window, the two never overlap (the owner's
// decision of 2026-10-11): a window the reader moved or resized keeps its place, the other standing
// beside it, where the two can stand side by side; where they cannot, the two are laid out afresh;
// only a page too narrow for both at their least overlaps them. Nothing about a paper's text is
// waited for: the window opens at the link's page and region whatever the words do. The
// pairing is always on, with nothing to turn it off (the owner's decision of 2026-10-11, after it
// had been turned off in Safari unseen). Where it opens nothing, the source window's head says why
// in a line (the owner's decision of 2026-10-11, after it opened nothing and said nothing in
// Safari): the reader follows someone, or nothing around the declaration is linked.

import { clusterSubject, declSubject, fileOf, linksOf, pairedLinks, parseSubject, subjectWords } from "../../shared/library.ts";
import type { Link } from "../../shared/library.ts";
import type { PaperWindow as PaperState } from "../../shared/collab.ts";
import type { ClusterMode } from "../../shared/graph.ts";
import type { ReviewChange, ReviewData } from "../../shared/review.ts";
import type { NoteCarry } from "../../shared/sticky.ts";
import type { Graph } from "../../shared/viewgraph.ts";
import type { Rect, Size } from "./floatwin.ts";
import { escapeHtml } from "./highlight.ts";
import { Library } from "./library.ts";
import type { Choosing } from "./library.ts";
import { pairArea, pairingStep, pairKeeps, pairPlaces, pairTop, unpairedLine } from "./paperdock.ts";
import type { Unpaired } from "./paperdock.ts";
import { PaperWin } from "./paperwin.ts";

/** A source window as the pairing knows it (web/src/sourcewin.ts): the following one or a pinned
 *  one. */
export interface PairedSource {
  readonly el: HTMLElement;
  /** the declaration it shows; -1 before the first */
  readonly decl: number;
  readonly collapsed: boolean;
  readonly pinned: boolean;
  /** whether the reader moved or resized it since the page last placed it */
  readonly byHand: boolean;
  rect(): Rect;
  /** once it shows the code of the declaration it is on, at the size the code gives it */
  drawn(): Promise<void>;
  /** laid out again where its rule puts it */
  relayout(): void;
  /** placed by the pairing: a pinned one at `at`, the following one by its rule; `at` null: let go
   *  of, a pinned one stepping aside */
  pairAt(at: Rect | null): void;
  /** why the pairing opened nothing beside it, as its head says it; null: nothing to say */
  unpaired(line: string | null): void;
}

const viewport = (): Size => ({ w: document.documentElement.clientWidth || innerWidth, h: document.documentElement.clientHeight || innerHeight });

export interface PapersHooks {
  review(): ReviewData;
  takeChange(c: ReviewChange): void;
  /** the graph on show (the board's, of a past build there) */
  graph(): Graph;
  /** the board's clustering */
  clustering(): ClusterMode;
  /** what is selected on the board, as a link's subject: a declaration, or a cluster */
  boardSubject(): string | null;
  /** why a link cannot be made on this board (a past build, a snapshot), or null */
  cannotLink(): string | null;
  /** go to a declaration by name, or a cluster by its subject, on the board (never leaving it) */
  goDecl(name: string): void;
  goCluster(kind: "ns" | "file", key: string): void;
  headers(): Record<string, string>;
  ensureName(): Promise<boolean>;
  /** whom this reader follows now, by name, or null: their reference window is mirrored, not
   *  paired */
  following(): string | null;
  changed(): void;
  say(text: string): void;
  /** the source windows laid out again: a reference window paired beside one, or gone, changes
   *  their room */
  relayoutSource(): void;
  /** the panel drawn again (a link's label being edited, given up) */
  repaint(): void;
  /** why nothing can be added to the library here (a snapshot of the page), or null */
  readOnly(): string | null;
  /** why no note can be written here (a preview of a view), or null */
  cannotNote(): string | null;
  /** a note of the project made carrying a clip, with that text (Clip to a note); whether it was */
  clip(c: NoteCarry, text: string): Promise<boolean>;
  /** a file or a clip attached to a note (its menu's Attach…); whether it was */
  attach(note: string, c: NoteCarry): Promise<boolean>;
}

export class Papers {
  readonly win: PaperWin;
  readonly library: Library;
  private hooks: PapersHooks;
  /** the declaration the pairing last opened a link for, so that a step back and forth reopens it */
  private pairedFor: string | null = null;
  /** the source window the reader last opened or stepped, pinned or not: the one paired */
  private pairedWin: PairedSource | null = null;
  /** a pinned window the pairing placed, which steps aside when the pairing goes to another */
  private placedPinned: PairedSource | null = null;
  /** the source windows whose head says why the pairing opened nothing beside them, and why */
  private told = new Map<PairedSource, Unpaired>();

  constructor(layer: HTMLElement, libBtn: HTMLElement, libPop: HTMLElement, panel: HTMLElement, hooks: PapersHooks) {
    this.hooks = hooks;
    this.win = new PaperWin(layer, {
      review: hooks.review,
      takeChange: hooks.takeChange,
      boardSubject: () => {
        const s = hooks.boardSubject();
        return s ? { subject: s, words: subjectWords(s) } : null;
      },
      cannotLink: hooks.cannotLink,
      goSubject: (s) => this.go(s),
      short: (s) => this.short(s),
      headers: hooks.headers,
      ensureName: hooks.ensureName,
      changed: () => {
        // docked or not changes only as the window opens, closes, collapses or is moved: not at every
        // page turned
        const dock = this.docked();
        if (dock !== this.wasDocked) this.redock();
        hooks.changed();
      },
      say: hooks.say,
      docked: (vp) => (this.docked() ? this.rects(vp)?.paper ?? null : null),
      placed: () => this.paperPlaced(),
      cannotNote: () => hooks.readOnly() ?? hooks.cannotNote(),
      clip: (c, text) => hooks.clip(c, text),
      attach: (note, c) => hooks.attach(note, c),
    });
    this.library = new Library(libBtn, libPop, {
      review: hooks.review,
      takeChange: hooks.takeChange,
      headers: hooks.headers,
      ensureName: hooks.ensureName,
      open: (sha, choosing) => {
        if (choosing && "attach" in choosing) return this.attachChosen(sha, choosing);
        void this.win.show(sha, { place: { page: 1 } }).then(() => {
          if (choosing) this.win.startLinking(choosing.link);
        });
      },
      links: (sha) => (hooks.review().links ?? []).filter((l) => l.file === sha).length,
      say: hooks.say,
      cannot: () => hooks.readOnly(),
    });
    // paired, the two are laid out again as the page is resized: the source window first, at its
    // place in the new page, then the two kept apart as the pairing keeps them (`redock`). Each
    // window's own listener lays it out again too, the reference window's before this one.
    window.addEventListener("resize", () => {
      const w = this.pairedWin;
      if (!w || !this.docked()) return;
      w.relayout();
      this.redock();
    });
    // the panels' links: opened, edited, removed; and Link to a reference…
    panel.addEventListener("click", (e) => this.panelClicked(e));
    panel.addEventListener("submit", (e) => {
      const f = (e.target as HTMLElement).closest<HTMLFormElement>("[data-pl-label]");
      if (!f) return;
      e.preventDefault();
      void this.relabel(f.dataset.plLabel!, f.querySelector("input")!.value);
    });
  }

  /** Source window `w`'s head says why the pairing opened nothing beside it; null: nothing. */
  private tell(w: PairedSource, why: Unpaired | null): void {
    for (const x of this.told.keys()) if (!x.el.isConnected) this.told.delete(x);
    if (why) this.told.set(w, why);
    else if (!this.told.delete(w)) return;
    w.unpaired(why && unpairedLine(why));
  }

  /** The heads that say what `stale` holds of their reason say it no more. */
  private untell(stale: (u: Unpaired) => boolean): void {
    for (const [w, u] of [...this.told]) if (stale(u)) this.tell(w, null);
  }

  /** Following ended: no source window says any more that the reader follows someone. */
  unfollowed(): void {
    this.untell((u) => "following" in u);
  }

  /** A subject in the few words a marker or a line has room for: a declaration by its last parts,
   *  a cluster as "ns P" or "file P". */
  short(subject: string): string {
    const p = parseSubject(subject);
    if (!p) return subject;
    const last = (n: string, k = 2) => n.split(".").slice(-k).join(".");
    return p.kind === "decl" ? last(p.name) : `${p.kind} ${last(p.name)}`;
  }

  /** Go to a subject on the board: a declaration (a visitor where the board does not hold it), or a
   *  cluster. */
  private go(subject: string): void {
    const p = parseSubject(subject);
    if (!p) return;
    if (p.kind === "decl") this.hooks.goDecl(p.name);
    else this.hooks.goCluster(p.kind, p.name);
  }

  // ---------------------------------------------------------------- the pairing

  /** Source window `w` shows declaration `i` — opened by the reader, or a step to it — and is the one
   *  paired from now on, pinned or not: the declaration's first link opens beside it, else its
   *  innermost linked cluster's; with none, the window says so and keeps what it showed. While the
   *  reader follows someone nothing opens: the reference window mirrors theirs, and stands beside
   *  `w` by the same rule while both are open, rather than over it between the panels, and waits
   *  unseen with it while it waits for its code (web/src/paperwin.ts, `dock`). Where nothing
   *  opens, `w`'s head says why. Whatever fails in finding the link or drawing the paper, the
   *  source window is never stopped by it. Otherwise the pairing waits until `w` shows the
   *  declaration's code, at the size the code gives it, and lays the two out then, in the same
   *  task: they appear, or change for a step, at once where they stay (the owner's decision of
   *  2026-10-12) — not first beside a window the size of "Reading the source…". */
  paired(i: number, w: PairedSource): void {
    const followed = this.hooks.following();
    if (followed !== null) {
      // another source window paired: the two laid out afresh, as the pairing lays them out
      if (this.take(w)) this.layOutAfresh();
      this.tell(w, { following: followed });
      return this.redock();
    }
    void w.drawn().then(() => {
      // stepped on meanwhile, or closed: the step that came after pairs
      if (w.decl !== i || !w.el.isConnected) return;
      try {
        this.pair(i, w);
      } catch {
        // the source window opened all the same; the reference window keeps what it showed
      }
    });
  }

  private pair(i: number, w: PairedSource): void {
    const v = this.hooks.graph().nodes[i];
    if (!v) return;
    const other = this.take(w);
    const d = this.hooks.review();
    const found = pairedLinks(d, v.name, v.module, this.hooks.clustering());
    const step = pairingStep({ found, recorded: (sha) => !!fileOf(d, sha), open: this.win.open, collapsed: this.win.collapsed, lit: this.win.lit, again: this.pairedFor === v.name, other });
    this.pairedFor = v.name;
    const short = this.short(declSubject(v.name));
    this.tell(w, "none" in step ? (step.none === "unlinked" ? { unlinked: short, mode: this.hooks.clustering() } : { unrecorded: short }) : null);
    if ("none" in step && step.said) this.win.setWhy({ note: `${short} has no link to a reference, nor has a cluster around it: the window keeps what it showed.` });
    if (!("open" in step)) return this.redock();
    if (step.afresh) this.layOutAfresh();
    // the window is open and placed once `show` starts: the source window takes its side at once,
    // without waiting for the paper to load
    void this.win.show(step.open.file, { link: step.open.id, why: { link: step.open, for: declSubject(v.name), others: found!.links } }).catch(() => {});
    this.redock();
  }

  /** Source window `w` is the one paired from now on; whether it is another than before. Where it
   *  is, a pinned window the pairing placed is let go of, a step aside where it has room (as tall as
   *  the pair, it has none, and stays). */
  private take(w: PairedSource): boolean {
    const before = this.pairedWin;
    this.pairedWin = w;
    const left = this.placedPinned;
    if (left && left !== w) {
      this.placedPinned = null;
      if (left.el.isConnected && !left.byHand) left.pairAt(null);
    }
    return before !== w;
  }

  /** The two paired windows placed by the pairing again: where the reader put either is forgotten. */
  private layOutAfresh(): void {
    const w = this.pairedWin;
    this.win.unmove();
    if (w?.el.isConnected) {
      if (!w.pinned) w.pairAt(null);
      else this.placePinned(w);
    }
  }

  /** The places the reader gave the two by hand kept where the two can stand side by side without
   *  overlapping, and let go of where they cannot, each window let go of then standing where the
   *  pairing puts it (web/src/paperdock.ts, `pairKeeps`): so that the pairing never shows the two
   *  overlapping (the owner's decision of 2026-10-11), but where the page is too narrow for both. */
  private keepApart(w: PairedSource): void {
    const keep = pairKeeps(w.byHand ? w.rect() : null, this.win.byHand ? this.win.rect() : null, pairArea(viewport(), pairTop()));
    if (this.win.byHand && !keep.paper) this.win.unmove();
    if (!w.byHand || keep.source) return;
    if (w.pinned) this.placePinned(w);
    else w.pairAt(null);
  }

  /** The reader moved or resized the reference window: the source window it is paired with, where
   *  the page placed it, stands beside where they put it, where it has room there. */
  private paperPlaced(): void {
    const w = this.pairedWin;
    if (!w || !this.docked()) return;
    if (w.pinned && !w.byHand) this.placePinned(w);
    else w.relayout();
  }

  /** A pinned source window put on the left of the two, or beside the reference window where the
   *  reader placed that: its place is its own, so the pairing sets it, as tall as the reference
   *  beside it — its size stays as set, and its code may not be drawn yet. Where the reader put it
   *  before is forgotten. */
  private placePinned(w: PairedSource): void {
    const r = this.rects(viewport(), true);
    if (!r) return;
    w.pairAt(r.source);
    this.placedPinned = w;
  }

  /** Where the two paired windows stand in viewport `vp` (web/src/paperdock.ts, `pairPlaces`): a
   *  window the reader placed by hand where they put it, the other beside it; neither placed, the
   *  source window at the width it has and the reference window beside it. `fresh`: placing the
   *  source window anew, at the width it has, wherever the reader put it. */
  private rects(vp: Size, fresh = false): { source: Rect; paper: Rect } | null {
    const w = this.pairedWin;
    if (!w?.el.isConnected) return null;
    const hand = (x: { byHand: boolean; rect(): Rect }) => (x.byHand ? x.rect() : null);
    return pairPlaces(w.rect().w, fresh ? null : hand(w), hand(this.win), pairArea(vp, pairTop()), vp);
  }

  /** While the paired source window `w` stands beside the reference window: the room it has there —
   *  how wide it may be, and how tall it is, the reference window's height — and where its rule puts
   *  it at the size its code gives it: on the left of the two, or beside the reference window where
   *  the reader placed that. Null for any other window, or while they are not paired. */
  dockFor(w: PairedSource): { room(vp: Size): Size; at(size: Size, vp: Size): Rect } | null {
    if (w !== this.pairedWin || !this.docked()) return null;
    const at = (width: number, vp: Size) => pairPlaces(width, null, this.win.byHand ? this.win.rect() : null, pairArea(vp, pairTop()), vp).source;
    return {
      room: (vp) => {
        const r = at(Infinity, vp);
        return { w: r.w, h: r.h };
      },
      at: (size, vp) => at(size.w, vp),
    };
  }

  /** whether the window was docked when it was last laid out beside the source window */
  private wasDocked = false;

  /** Lay the reference window out beside the paired source window, where the two are paired, the two
   *  kept apart (`keepApart`). The source windows are laid out first, to take or give back the room
   *  beside it, at the size they have now — the code of a step may have just been drawn — so that
   *  the reference window is placed beside that size in this same task, not beside the size before
   *  until the source window's ResizeObserver says otherwise a frame later. */
  redock(): void {
    this.wasDocked = this.docked();
    const w = this.wasDocked ? this.pairedWin : null;
    this.hooks.relayoutSource();
    w?.relayout();
    if (w) this.keepApart(w);
    this.win.dock(w?.el ?? null);
    if (w?.pinned && !w.byHand) this.placePinned(w);
  }

  /** Whether the reference window stands beside source window `w` now, paired with it: Space, which
   *  closes `w`, closes the two together (the owner's decision of 2026-10-11). */
  besideOf(w: PairedSource): boolean {
    return w === this.pairedWin && this.docked();
  }

  /** Whether the reference window stands beside a source window now: open and not collapsed, and the
   *  source window it is paired with open and not collapsed. */
  docked(): boolean {
    const w = this.pairedWin;
    return this.win.open && !this.win.collapsed && !!w && w.el.isConnected && !w.collapsed;
  }

  // ---------------------------------------------------------------- what notes carry

  /** A file or a clip a note carries, clicked: opened in the reference window — a clip at its page with
   *  its region lit, a paper at its first page (or the page it is carried at), an image whole. */
  openCarry(c: NoteCarry): void {
    if (!fileOf(this.hooks.review(), c.file)) return this.hooks.say("The library has no record of that file: it came with a note, not with the review.");
    const spot = c.region ? { page: c.page, region: c.region } : null;
    void this.win.show(c.file, { place: c.page ? { page: c.page, ...(c.region ? { region: c.region } : {}) } : { page: 1 }, spot, why: { note: c.region ? "A clip a note carries, lit." : "A file a note carries." } });
  }

  /** A file of the library opened in the reference window, at its first page (Activity's events). */
  openFile(sha: string): void {
    void this.win.show(sha, { place: { page: 1 } });
  }

  /** The reference window opened at a link, lit, with the others of its subject offered. */
  openLink(id: string): void {
    const d = this.hooks.review();
    const l = (d.links ?? []).find((x) => x.id === id);
    if (!l) return this.hooks.say("That link was removed.");
    void this.win.show(l.file, { link: l.id, why: { link: l, others: linksOf(d, l.subject) } });
  }

  /** The headers of a request that writes: the reader's name, as the review's are sent. */
  headers(): Record<string, string> {
    return this.hooks.headers();
  }

  /** A note's "Attach…": the library opened to choose the file, `label` the note's first words. */
  chooseToAttach(note: string, label: string): void {
    this.library.show({ attach: note, label });
  }

  /** The file chosen to attach to a note: an image attached at once, whole; a paper opened in the
   *  window to attach it whole or by a clip of it. */
  private attachChosen(sha: string, c: Extract<Choosing, { attach: string }>): void {
    const f = fileOf(this.hooks.review(), sha);
    if (!f) return this.hooks.say("The library has no such file.");
    if (f.type !== "pdf") return void this.hooks.attach(c.attach, { file: sha });
    void this.win.show(sha, { place: { page: 1 } }).then(() => this.win.startAttaching(c.attach, c.label));
  }

  // ---------------------------------------------------------------- presence

  state(): PaperState | null {
    return this.win.state();
  }

  mirror(s: PaperState | null | undefined): void {
    this.win.mirror(s);
  }

  /** The review changed: the window and the library follow, and a source window's head that said
   *  nothing around its declaration was linked says so only while it is still true (the link it
   *  lacked may have just been made). */
  refresh(): void {
    this.win.refresh();
    this.library.refresh();
    const d = this.hooks.review();
    const g = this.hooks.graph();
    for (const [w, u] of [...this.told]) {
      if (!("unlinked" in u || "unrecorded" in u)) continue;
      const v = g.nodes[w.decl];
      if (!v) {
        this.tell(w, null);
        continue;
      }
      const first = pairedLinks(d, v.name, v.module, this.hooks.clustering())?.links[0];
      if (first) this.tell(w, fileOf(d, first.file) ? null : { unrecorded: this.short(declSubject(v.name)) });
    }
  }

  // ---------------------------------------------------------------- the panels

  /** A declaration's links, as its panel lists them (decision 7). */
  declHtml(i: number): string {
    const g = this.hooks.graph();
    const v = g.nodes[i];
    if (!v) return "";
    return this.listHtml(declSubject(v.name), g.isExt(i));
  }

  /** A cluster's links, as its panel lists them. */
  clusterHtml(key: string, mode: ClusterMode): string {
    return this.listHtml(clusterSubject(key, mode), false);
  }

  private listHtml(subject: string, outside: boolean): string {
    const d = this.hooks.review();
    const ls = linksOf(d, subject);
    const no = this.hooks.cannotLink();
    if (!ls.length && (outside || no)) return "";
    const rows = ls.map((l) => this.rowHtml(l)).join("");
    const add = no ? "" : `<button class="link pl-add" data-pl-start="${escapeHtml(subject)}" title="Choose a file of the library, go to the place, then Link here">Link to a reference…</button>`;
    return `<div class="pl-sec"><div class="sec">References <span class="muted">${ls.length ? ls.length : "— none linked yet"}</span>${add}</div>${rows ? `<div class="pl-list">${rows}</div>` : ""}</div>`;
  }

  private editing: string | null = null;
  private removing: string | null = null;

  private rowHtml(l: Link): string {
    const e = escapeHtml;
    const f = fileOf(this.hooks.review(), l.file);
    const title = f ? f.title : "a file this server has no record of";
    if (this.editing === l.id)
      return `<form class="pl-row pl-edit" data-pl-label="${l.id}"><input value="${e(l.label)}" maxlength="200" aria-label="The link's label"><button class="rv-btn primary">Save</button><button type="button" class="rv-btn" data-pl-cancel>Cancel</button></form>`;
    const sure =
      this.removing === l.id
        ? `<span class="pl-sure">Remove this link? <button class="link" data-pl-remove-yes="${l.id}">Remove</button> <button class="link" data-pl-cancel>Keep</button></span>`
        : "";
    const no = this.hooks.cannotLink();
    return (
      `<div class="pl-row"><button class="pl-open" data-pl-open="${l.id}" title="Open ${e(title)} at this place">📄 <span class="pl-label">${e(l.label)}</span> <span class="pl-file muted">${e(title)}${f?.archived ? " (archived)" : ""}</span></button>` +
      `<span class="pl-by muted" title="Linked by ${e(l.by)}${l.agent ? ", an AI agent" : ""}, ${e(l.at.slice(0, 10))}">${l.agent ? "🤖 " : ""}${e(l.by)}</span>` +
      (no ? "" : `<span class="pl-acts"><button class="icon" data-pl-edit="${l.id}" title="Edit its label" aria-label="Edit its label">✎</button><button class="icon" data-pl-remove="${l.id}" title="Remove this link" aria-label="Remove">✕</button></span>`) +
      `${sure}</div>`
    );
  }

  private panelClicked(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const at = (a: string) => t.closest<HTMLElement>(`[${a}]`)?.getAttribute(a) ?? null;
    const open = at("data-pl-open");
    if (open) {
      const l = (this.hooks.review().links ?? []).find((x) => x.id === open);
      if (l) void this.win.show(l.file, { link: l.id, why: { link: l, others: linksOf(this.hooks.review(), l.subject) } });
      return;
    }
    const start = at("data-pl-start");
    if (start) return this.library.show({ link: start });
    const edit = at("data-pl-edit");
    if (edit) {
      this.editing = edit;
      this.removing = null;
      return this.redrawPanel(t);
    }
    const rm = at("data-pl-remove");
    if (rm) {
      this.removing = rm;
      this.editing = null;
      return this.redrawPanel(t);
    }
    const yes = at("data-pl-remove-yes");
    if (yes) return void this.remove(yes);
    if (t.closest("[data-pl-cancel]")) {
      this.editing = this.removing = null;
      return this.redrawPanel(t);
    }
  }

  /** The panel's list of links drawn again where it is, the rest of the panel as it is. */
  private redrawPanel(t: HTMLElement): void {
    const sec = t.closest<HTMLElement>(".pl-sec");
    const subject = sec?.querySelector<HTMLElement>("[data-pl-start]")?.dataset.plStart ?? (this.hooks.review().links ?? []).find((l) => l.id === (this.editing ?? this.removing))?.subject;
    if (!sec || !subject) return;
    const html = this.listHtml(subject, false);
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    if (tmp.firstElementChild) sec.replaceWith(tmp.firstElementChild);
    document.querySelector<HTMLInputElement>(".pl-edit input")?.select();
  }

  private async write(path: string, body: object): Promise<boolean> {
    if (!(await this.hooks.ensureName())) return false;
    const r = await fetch(path, { method: "POST", headers: this.hooks.headers(), body: JSON.stringify(body) }).catch(() => null);
    const b = (await r?.json().catch(() => null)) as { error?: string; change?: ReviewChange } | null;
    if (!r?.ok) {
      this.hooks.say(b?.error ?? "The server could not be reached.");
      return false;
    }
    if (b?.change) this.hooks.takeChange(b.change);
    return true;
  }

  private async relabel(id: string, label: string): Promise<void> {
    this.editing = null;
    if (label.trim()) await this.write("/api/library/link/edit", { id, label: label.trim() });
    // the panel drawn again whatever the answer: a label saved as it was, or refused, changes
    // nothing in the review, which is what draws it again otherwise, and Save left the form open
    this.hooks.repaint();
  }

  private async remove(id: string): Promise<void> {
    this.removing = null;
    await this.write("/api/library/unlink", { id });
  }
}
