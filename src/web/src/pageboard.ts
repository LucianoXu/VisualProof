// The board: the canvas (web/src/canvas.ts) with what lies over it and the pointer's tooltip, the
// notes on it (web/src/sticky.ts), and the linear form (ExportSpec decision 18, web/src/linear.ts).
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import { fixedScope } from "../../shared/views.ts";
import { GraphCanvas } from "./canvas.ts";
import { escapeHtml } from "./highlight.ts";
import { dragMoves } from "./drag.ts";
import { Notes } from "./notes.ts";
import { Stickies } from "./sticky.ts";
import { kindDot, ringed } from "./axiomring.ts";
import { fileOf } from "../../shared/library.ts";
import { mineLabel, STATUS_LABEL, STATUSES } from "./status.ts";
import { LinearForm } from "./linear.ts";
import { markWords } from "./past.ts";
import { $, STATE_LABEL, short } from "./page.ts";
import type { Page } from "./page.ts";

/** What the board gives the page's other parts. */
export interface BoardPart {
  notes: Notes;
  canvas: GraphCanvas;
  ownOpen: Map<string, boolean>;
  stickies: Stickies;
  linear: LinearForm;
}

export function boardPart(page: Page): BoardPart {
  const { data, S, kept, reader } = page;

  const notes = new Notes($("#notes"));
  /** What lies over the canvas, where no card goes: the bar, the tabs, the side panel, the
   *  declaration's panel while open, the strip, the eyes, the legend. */
  const covering = ["#bar", "#tabs", ".views-wrap", "#tmbar", "#tm-list", "#tm-kept", "#lightup", "#selbar", "#side", "#panel.open", "#lensbar", "#zoom", "#legend", "#activity.open", "#lostfound.open", "#board-pop", "#trust-list", "#eyes-pop"];
  const overlays = () =>
    covering.flatMap((q) => {
      const r = document.querySelector<HTMLElement>(q)?.getBoundingClientRect();
      return r && r.width && r.height ? [r] : [];
    });
  const canvas = new GraphCanvas($("#canvas") as HTMLCanvasElement, $("#labels") as HTMLCanvasElement, $("#cards"), page.g, {
    covers: overlays,
    // a click with the tool (web/src/selection.ts); a double-click on a cluster folds or opens it,
    // which the canvas does itself
    nodeClick: (j, shift) => void page.clickOn(page.pickDecl(page.vg().nodes[j].name), shift),
    // a visitor is a declaration as any: clicked with the tool (ViewSpec decision 27)
    visitorClick: (k, shift) => {
      if (page.visitors[k]) page.clickOn(page.pickDecl(page.visitors[k].name), shift);
    },
    clusterClick: (c, shift) => void page.clickOn(page.pickCluster(c), shift),
    backgroundClick: () => {
      page.clear();
      page.commit();
    },
    hover: (t, x, y) => {
      const tip = $("#tip");
      if (!t) {
        tip.hidden = true;
        return;
      }
      if (t.kind === "node") {
        const i = t.i;
        const v = page.vg().nodes[i];
        const f = canvas.fileOf(i);
        // by status, the state in words beside its colour; by one's own review (Mine), whose it is;
        // by kind, the file's build trouble
        const ss = STATUSES[canvas.statusOf(i)];
        const st =
          canvas.scheme === "status"
            ? ` <span class="tip-st">${STATUS_LABEL[ss]}</span>`
            : canvas.scheme === "mine"
              ? ` <span class="tip-st">${escapeHtml(mineLabel(canvas.statusOf(i), page.mineWhose()))}</span>`
              : f && STATE_LABEL[f.state]
                ? ` <span class="tip-st st-${f.state}">${STATE_LABEL[f.state]}</span>`
                : "";
        // an axiom's ringed, in every scheme (web/src/axiomring.ts)
        const dot = canvas.scheme !== "kind" ? `ss s-${ss}${page.vg().isExt(i) ? " k-external" : ""}${ringed(v.kind) ? " axiom" : ""}` : kindDot(v.kind, page.vg().isExt(i));
        // on a past graph, what became of it since
        const then = markWords(canvas.pastMarkOf(i), canvas.nowNameOf(i));
        tip.innerHTML = `<span class="dot ${dot}"></span>${escapeHtml(v.name)}${st}${then.length ? ` <span class="tip-st tip-tm">${escapeHtml(then.join(" · "))}</span>` : ""}`;
      } else if (t.kind === "visitor") {
        // a visitor: what it is, and that it is the reader's own, not of the board
        const vis = page.visitors[t.k];
        const i = vis ? page.g.byName.get(vis.name) : undefined;
        if (!vis || i === undefined) return void (tip.hidden = true);
        const dot = kindDot(page.g.nodes[i].kind, page.g.isExt(i));
        // on a folded cluster's card: which one, and that selecting it opens it for the reader alone
        const card = canvas.visitorCard(t.k);
        const inside = card >= 0 ? `; inside folded ${escapeHtml(canvas.layout.clusters[card].label)}, a click opens it for you` : "";
        tip.innerHTML =
          `<span class="dot ${dot}"></span>${escapeHtml(vis.name)} <span class="tip-st tip-visit">visiting — not on this board` +
          `${vis.from ? `; reached from ${escapeHtml(short(vis.from))}` : ""}${inside} · Add to view keeps it</span>`;
      } else {
        const cl = canvas.layout.clusters[t.c];
        // folded on the board but open for the reader's visitor (ViewSpec decision 27): double-click
        // opens it for everyone
        const what = canvas.openForVisitor(t.c)
          ? "folded on this board, open for your visitor · double-click to open it for everyone"
          : `click to select · double-click to ${canvas.folded.has(t.c) ? "open" : "fold"}`;
        // a drag moves it only with the lock let go, or the drag key held on a locked layout
        tip.innerHTML =
          `<span class="dot cluster-dot"></span>${escapeHtml(cl.key.replace("⟨external⟩", "External"))}` +
          ` <span class="tip-st">${cl.count.toLocaleString()} · ${what}${page.dragging() ? " · drag to move" : ""}</span>`;
      }
      tip.style.transform = `translate(${x + 14}px, ${y + 12}px)`;
      tip.hidden = false;
    },
    pinsChanged: () => {
      page.sync.sharePins();
      linear.refresh();
      const i = page.selected();
      if (i !== null) page.panel.show(i);
    },
    foldChanged: () => {
      page.sync.shareFolds();
      page.outline.render();
      page.clusterPanel.refresh();
      page.showLevel();
    },
    menu: (t, x, y, world) => page.openMenu(t, x, y, world),
    frozenDrag: () => page.say(page.frozenWhy()),
  });

  /** a read-only reader's notes opened or collapsed, by id (CollabSpec decision 11, the owner's
   *  decision of 2026-10-16): theirs alone, over the state everyone shares, in this page and gone on
   *  reload, as their folds are */
  const ownOpen = new Map<string, boolean>(reader && kept ? kept.notes : []);
  /** Notes as this page shows them: each open or collapsed as its reader left it, where it is theirs
   *  alone (`ownOpen`), else by its own state. */
  const asOpenHere = <T extends { id: string; open: boolean }>(ns: T[]): T[] =>
    ownOpen.size ? ns.map((n) => (ownOpen.has(n.id) && ownOpen.get(n.id) !== n.open ? { ...n, open: ownOpen.get(n.id)! } : n)) : ns;

  // the notes on the board on show (web/src/sticky.ts): the project's that the board holds and the
  // view's own, placed again every frame the canvas draws; what is done to one goes to everyone, as
  // the view's operations or the project's notes' (AttachmentSpec decisions 13–19)
  const stickies: Stickies = new Stickies($("#stickies"), canvas, {
    notes: () => ({ project: asOpenHere(page.projectNotes.list), view: asOpenHere(page.nav.board?.rec.notes ?? []) }),
    // the Project holds every note of the project; another board what its scope gives and its
    // view's lists (the owner's decision of 2026-10-11), the links read as the board reads the review
    items: () => ({ all: !page.nav.board || fixedScope(page.nav.board.rec), items: page.nav.board?.rec.items, links: page.boardReview().links ?? [] }),
    board: () => (page.nav.board ? { nodes: page.vg().nodes, full: page.nav.board.full.nodes, mode: page.cm(), nowName: page.nav.board.past?.past.nowName } : null),
    // a note attached to a declaration shows at the reader's visitor of it, and falls back under the
    // other clustering to beside it in the Project's layout of that clustering
    visitors: () => page.visitors.map((v) => v.name),
    whole: (m) => ({ L: page.meta.layouts[m], index: page.present.byName }),
    resolve: (name) => (page.g.byName.has(name) ? name : null),
    go: (name) => {
      const i = page.g.byName.get(name);
      if (i !== undefined) page.go(i);
    },
    moves: (h) => !page.frozen() && dragMoves(page.locked, h),
    setOpen: (id, _kind, open) => page.setNoteOpen(id, open),
    moved: (id, to) => void page.moveNote(id, to),
    // where a card hangs from its icon is shared as its state is, and is no edit
    card: (id, kind, card) => void (kind === "project" ? page.projectOps([{ op: "pnote-card", id, card }]) : page.noteOps([{ op: "note-card", id, card }])),
    edit: (id) => void page.editNote(id),
    menu: (id, x, y) => page.openNoteMenu(id, x, y),
    unfold: (c) => canvas.toggleFold(c),
    // the library is the server's now, whatever build the board shows
    file: (sha) => fileOf(page.review.data, sha),
    noFiles: () => !!data.snapshot,
    openCarry: (_id, c) => page.papers.openCarry(c),
  });
  canvas.onFrame = () => stickies.frame();
  // Fit to screen, and a board's first framing, hold the notes' icons too, and their cards where
  // they fit
  canvas.fitExtra = (k, cards) => stickies.fitBoxes(k, cards);

  // the linear form (ExportSpec decision 18, web/src/linear.ts): the board drawn as its document's
  // outline, while the Export window is open or at the reader's asking (⋯, o)
  const linearBtn = $("#linear-btn");
  const linear: LinearForm = new LinearForm($("#linear") as HTMLCanvasElement, canvas, {
    outline: () => {
      const b = page.nav.board;
      if (!b) return Promise.resolve("There is no board on show.");
      // the build the board shows, as its document is printed at it (ExportSpec decision 16)
      const version = b.preview ? (b.past?.past?.snapshot.id ?? null) : undefined;
      return data.exportOutline(b.id, version);
    },
    graph: () => page.vg(),
    noteSpot: (id) => stickies.spotOf(id),
    lit: (i) => !!canvas.active?.[i],
    edgeLit: (u, v, site) => canvas.edgeLit(u, v, site),
    keyLinks: () => canvas.keyLinks,
    selectDecl: (i, shift) => void page.clickOn(page.pickDecl(page.vg().nodes[i].name), shift),
    selectSection: (c, shift) => void page.clickOn(page.pickCluster(c), shift),
    frozen: () => (page.frozen() ? page.frozenWhy() : null),
    edges: () => S.showEdges,
    moveNote: (id, key, world, detach) => stickies.moveInto(id, key, world, detach),
    noteText: (id) => page.noteOf(id)?.note.text ?? null,
    noteOpen: (id) => page.noteOpenHere(id),
    toggleNote: (id) => page.setNoteOpen(id, !page.noteOpenHere(id)),
    // the board's menu on what a row is; Fold and Fit are the form's (menuAct)
    menu: (on, x, y, spot) => {
      if (on?.kind === "note") page.openNoteMenu(on.id, x, y);
      else page.openMenu(on?.kind === "decl" ? { kind: "node", i: on.i } : on ? { kind: "cluster", c: on.c } : null, x, y, spot ?? canvas.toWorld(x, y), false, on?.kind === "cluster" ? on.folded : undefined);
      if (page.menuOn) page.menuOn.linear = true;
    },
    // the Export window, at the right, beside which the line is drawn
    beside: () => (page.exportModal.isOpen ? ($("#export-modal .ex-box")?.getBoundingClientRect().width ?? 0) + 24 : 0),
    say: (text) => page.say(text),
    changed: (on) => {
      linearBtn.classList.toggle("on", on);
      linearBtn.setAttribute("aria-pressed", String(on));
      page.people.report();
    },
  });
  linearBtn.addEventListener("click", () => linear.toggle());
  // the notes the outline holds are those the board shows
  stickies.onRender = () => linear.refresh();

  return { notes, canvas, ownOpen, stickies, linear };
}
