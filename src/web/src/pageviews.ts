// The page's views (ViewSpec.md, web/src/views.ts): the board on show and the tabs that keep the
// views open (web/src/viewnav.ts), the boards laid out off the page's thread, the Time Machine
// (HistorySpec decisions 15–19, web/src/timemachine.ts) and the ways into it, and a board put on
// the canvas.
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import type { ClusterMode, Layout } from "../../shared/graph.ts";
import { briefWhen } from "../../shared/titles.ts";
import { versionName } from "../../shared/views.ts";
import { Graph } from "../../shared/viewgraph.ts";
import { ProjectNotes } from "./projectnotes.ts";
import { READ_ONLY } from "./people.ts";
import { ViewNav } from "./viewnav.ts";
import type { Place } from "./viewnav.ts";
import { Views } from "./views.ts";
import { LayoutQueue } from "./layoutqueue.ts";
import type { LayoutWorker } from "./layoutqueue.ts";
import type { Board } from "./views.ts";
import { TimeMachine } from "./timemachine.ts";
import type { TimeMachineAt } from "./timemachine.ts";
import { boardMarks } from "./past.ts";
import { $ } from "./page.ts";
import type { Page } from "./page.ts";

/** What the views give the page's other parts. */
export interface ViewsPart {
  stay: () => void;
  views: Views;
  projectNotes: ProjectNotes;
  nav: ViewNav;
  vg: () => Graph;
  toView: (i: number) => number;
  toFull: (j: number) => number;
  cm: () => ClusterMode;
  tm: TimeMachine;
  pastShown: () => boolean;
  frozen: () => boolean;
  frozenWhy: () => string;
  openDerived: (scope: string, to: Place | null, clustering?: ClusterMode, focus?: string | null) => Promise<boolean | string>;
  timeMachine: (at?: TimeMachineAt) => void;
  noSwitch: () => boolean;
  openTimeMachine: (at?: TimeMachineAt) => Promise<boolean>;
}

export async function viewsPart(page: Page): Promise<ViewsPart> {
  const { data, store, reader } = page;

  // ---------------------------------------------------------------- the views
  //
  // The view on show is a board (web/src/views.ts): the canvas shows its graph — the whole one, or
  // the part its scope holds — and the panel always speaks of the whole graph. `nav` keeps the tabs.

  // the boards of the latest build the page lays out — a view of a part of the project: Zoom in, a
  // target's, one nobody keeps — off the page's thread, as the Time Machine's past boards are
  // (web/src/layoutqueue.ts, web/src/layoutworker.ts; the owner's decision of 2026-10-18): one at a
  // time, the board a step goes to before the board on show; one that neither is any more is dropped,
  // or stopped when another waits. A snapshot's page opens from disk, where no worker is served: it
  // lays them out itself (web/src/views.ts).
  const boardTags: string[] = [];
  const boardTag = (id: string) => {
    const k = boardTags.indexOf(id);
    return k >= 0 ? k : boardTags.push(id) - 1;
  };
  const boardQueue = new LayoutQueue(
    (tag) => (boardTags[tag] === nav.aimed ? 2 : boardTags[tag] === nav.board?.id ? 1 : 0),
    () => (typeof Worker === "undefined" ? null : (new Worker("/layout.js", { type: "module" }) as unknown as LayoutWorker)),
  );
  /** the layouts running or waiting, by the view each is of: while the step on its way waits for
   *  one, the tabs' busy mark, as the Time Machine's bar has its own */
  const awaited = new Map<Promise<Layout>, string>();
  const syncBusy = () => page.tabs.busy(nav.aimed !== null && [...awaited.values()].includes(nav.aimed));
  const layOutBoard = (id: string, ask: Parameters<LayoutQueue["lay"]>[1]): Promise<Layout> => {
    const p = boardQueue.lay(boardTag(id), ask);
    awaited.set(p, id);
    syncBusy();
    const done = () => {
      awaited.delete(p);
      syncBusy();
    };
    p.then(done, done);
    return p;
  };
  /** The reader stays on the board on show: a step still waiting for another board's layout is given
   *  up (web/src/viewnav.ts), and the tabs' busy mark goes with it. */
  const stay = () => {
    nav.stay();
    boardQueue.prune();
    syncBusy();
  };
  const views = new Views(data.views, {
    ...(data.snapshot ? {} : { layOut: layOutBoard }),
    graph: () => page.present,
    handsOver: () => page.handsOver(),
    meta: () => page.meta,
    review: () => page.review.data,
    // a view in the Time Machine, or kept at a past build, shows that build's graph; at another build
    // than its own, it is a preview
    past: (rec) => (data.snapshot ? null : tm.sourceFor(rec)),
    prepare: (rec) => (data.snapshot ? Promise.resolve() : tm.prepare(rec)),
    // the build a view nobody named is kept at, in its title
    build: (id) => {
      const s = tm.snaps.find((x) => x.id === id);
      return s ? briefWhen(s.at) : null;
    },
    preview: (rec, past) => !data.snapshot && tm.preview(rec, past),
  });
  await views.load();
  // the project's notes (AttachmentSpec decision 13): every one, whichever board is on show
  const projectNotes = new ProjectNotes(data.views, () => page.people?.stream ?? null);
  await projectNotes.load();
  const nav = new ViewNav(views, store, {
    show: (b, L) => showBoard(b, L),
    place: (p, fresh) => page.place(p, fresh),
    here: () => page.here(),
    // the address is written by the step that showed the view (one entry), or replaced after
    changed: () => {
      syncBusy();
      page.renderTabs();
      page.people.report();
    },
  });
  const vg = () => nav.board.graph;
  const toView = (i: number) => nav.board.toView(i);
  const toFull = (j: number) => nav.board.toFull(j);
  /** the board's clustering */
  const cm = (): ClusterMode => nav.board.rec.clustering;

  // ---------------------------------------------------------------- the Time Machine
  //
  // The view on show at a past build (HistorySpec decisions 15–19, web/src/timemachine.ts): its bar
  // takes the tabs' place while it is open; a view kept at a past build shows that build too.

  const tm: TimeMachine = new TimeMachine($("#tmbar"), $("#tm-list"), $("#tm-kept"), {
    present: () => page.present,
    meta: () => page.meta,
    review: () => page.review.data,
    board: () => nav.board ?? null,
    title: (id) => views.title(id),
    tip: (id) => views.tip(id),
    redraw: () => nav.redraw(),
    memory: (id, mode) => data.views.memory(id, mode),
    changed: () => {
      page.people.report();
      syncPast();
    },
    go: (name) => page.goName(name),
    say: (text) => page.say(text),
    keep: async (snapshot) => {
      if (reader) return READ_ONLY;
      if (!(await page.people.ensureLayout())) return "Keeping a build in a view is recorded under your name: give one first.";
      const why = await page.sync.keepVersion(snapshot);
      page.renderTabs();
      return why;
    },
    saveAs: (snapshot) => saveVersion(snapshot),
    frozen: () => (reader ? READ_ONLY : null),
    following: () => page.people.following,
    newBuild: (from, to) => void page.newBuild(from, to),
  });
  /** The board on show is of a past graph: a view kept at a past build, or the Time Machine's. It is
   *  a board as any other (the owner's decision of 2026-10-10), but for the review: a past build is
   *  not reviewed. Its document is that build's (ExportSpec decision 16). */
  const pastShown = (): boolean => !!nav.board?.past;
  /** The board on show is a preview of its view at another build than its own (web/src/views.ts,
   *  `preview`): the Time Machine browsing it, or its build while that cannot be read. Nothing
   *  arranges it there: the view's own board is another. */
  const frozen = (): boolean => !!reader || (!data.snapshot && !!nav.board?.preview);
  /** Why arranging was refused there, in words. */
  const frozenWhy = (): string =>
    reader
      ? READ_ONLY
      : tm.active
      ? "The Time Machine shows this view at another build than its own: Keep this version, or Save as new view, to arrange it."
      : "This view's build could not be read: it is shown at the latest build, and is arranged once its own build shows.";
  /** The build the board on show is of: the one the Time Machine shows on it, else the one its view is
   *  kept at; null for the latest. What is made from a board of a past build keeps that build (the
   *  owner's decision of 2026-10-09): Zoom in, a cluster's Zoom in, a target's key declarations. */
  const boardBuild = (): number | null => {
    if (!nav.board) return null;
    if (tm.active && nav.board.id === tm.view) return tm.shown === tm.latest ? null : tm.shown;
    return nav.board.rec.version ?? null;
  };
  /** Open a view made from the board on show, at the board's build (`boardBuild`): a past board's
   *  derived view is read-only at that build, as a view kept there is. From the Time Machine, the
   *  view is shown first and the Time Machine left after, so that no board of now comes between. */
  const openDerived = async (scope: string, to: Place | null, clustering?: ClusterMode, focus: string | null = page.viewFocusName()): Promise<boolean | string> => {
    // a read-only reader opens the views there are, and makes none (CollabSpec decision 11)
    if (reader) return READ_ONLY;
    const version = boardBuild();
    const leaving = tm.active;
    // a new view's focus (ViewSpec decision 28): the target it is made from, else the focus of the
    // view it is made from
    const r = await tm.leaveFor(() => nav.open(scope, to, { version, ...(clustering ? { clustering } : {}), ...(focus !== null ? { focus } : {}) }));
    // the tabs were hidden while it was shown: drawn again now, its tab brought into sight
    if (leaving && r === true) page.renderTabs();
    return r;
  };
  let visitorsOn = "";
  /** the board the notes were last drawn for */
  let stickiesOn = "";

  /** The board on show is of another graph (a past build's, or the graph on show again): what
   *  speaks of the whole graph — the panel, the review, the search, the source windows — speaks of
   *  it. A pinned window shows its declaration there, found by name: on a past board, as that build
   *  had it (HistorySpec decision 23). */
  const useGraph = (G: Graph) => {
    page.g = G;
    page.panel.g = page.g;
    page.reviewBox.g = page.g;
    page.searchBox.setGraph(page.g);
    if (page.sources.all.some((w) => w.g !== G)) {
      for (const w of page.sources.all) w.g = G;
      page.sources.redraw((name) => G.byName.get(name));
    }
  };

  /** What shows whether the board on show is of a past build: the page's class, Export (which prints
   *  the build on show), the note of a view kept at a build. */
  const syncPast = () => {
    document.body.classList.toggle("past", pastShown());
    // a snapshot of the page makes pictures of its board, not documents (ExportSpec decision 19)
    $("#export-btn").title = data.snapshot
      ? "Artwork: the board as a picture, PNG or SVG (a snapshot's documents are the server's)"
      : pastShown()
        ? "Export: this view at the build on show, as a document typeset with LaTeX; or the board as a picture (Artwork)"
        : "Export: this view as a document, typeset with LaTeX; or the board as a picture (Artwork)";
    tm.renderKept();
    page.syncInsets();
  };

  /** Put a board on the canvas: its graph, its layout with its pins and folds, its clustering; on a
   *  past graph, its marks against now (HistorySpec decision 17), set before its pins, which are kept
   *  under the names of now; a preview, which nothing arranges. */
  const showBoard = (b: Board, L: Layout) => {
    const m = b.rec.clustering;
    // visitors are of the board they were made on: another has none (ViewSpec decision 27), and
    // nothing of them reaches its scene
    if (b.id !== visitorsOn) {
      page.visitors = [];
      visitorsOn = b.id;
      page.canvas.setVisitors([], [], []);
    }
    if (b.full !== page.g) useGraph(b.full);
    page.canvas.setGraph(b.graph);
    const marks = b.past ? boardMarks(b.past.past, b.graph.n, b.toFull) : null;
    page.canvas.setPast(marks?.marks ?? null, marks?.now);
    page.canvas.setLayout(L, b.rec.pins[m], b.rec.folds[m], m);
    page.canvas.setFrozen(frozen());
    page.linear.refresh();
    page.exportModal.boardChanged();
    // a note being written stays while its board is drawn again (the review changed what it
    // holds); another board closes it
    if (b.id !== stickiesOn) page.stickies.reset();
    stickiesOn = b.id;
    page.stickies.render();
    page.outline.setLayout(L, `${b.id}\u0000${m}`);
    page.canvas.setBuild(b.past ? null : page.build?.files ?? null);
    // the whole project's layout holds the outside world; a scope without it hides it
    page.canvas.setShowExternals(b.bs.whole ? b.bs.outside : true);
    for (const btn of document.querySelectorAll<HTMLElement>("#board-pop [data-cluster]")) btn.classList.toggle("on", btn.dataset.cluster === m);
    $("#side-what").textContent = m === "module" ? "Files" : "Namespaces";
    page.notes.clear();
    page.syncStatus();
    page.applyScheme();
    page.showLevel();
    page.syncPeers();
    page.boardPanel.render();
    page.renderHidden();
    page.apply();
    syncPast();
  };

  /** Views are not switched in the Time Machine (HistorySpec decision 16): true, and the reader is
   *  told so, while it is open. */
  const noSwitch = (): boolean => {
    if (!tm.active) return false;
    page.say("Views are not switched in the Time Machine: leave it first (Esc).");
    return true;
  };

  // ---------------------------------------------------------------- into the Time Machine

  /** Open the Time Machine at a build (`snapshot`; the latest where left out), on a declaration
   *  (`name`): the build-status popover's Time Machine and recent builds, and the lost-and-found's
   *  Show in history, all come here. */
  const timeMachine = (at?: TimeMachineAt): void => void openTimeMachine(at);

  /** Open the Time Machine on the view on show (the hook the build-status popover and the
   *  lost-and-found call): at `snapshot`, the latest by default; on `name` there — a visitor of that
   *  build where this view does not hold it (ViewSpec decision 27). */
  const openTimeMachine = async (at: TimeMachineAt = {}): Promise<boolean> => {
    if (data.snapshot) {
      page.say("A snapshot has no history: the Time Machine is the server's.");
      return false;
    }
    if (!(await tm.open({ snapshot: at.snapshot }))) return false;
    page.offerTip("first-time-machine");
    if (!at.name || page.goName(at.name)) return true;
    page.say(`${at.name} is not in the graph of that build.`);
    return true;
  };

  /** Save as new view (HistorySpec decision 19): a copy of the view on show kept at a build, named
   *  for it, and gone to at once (the owner's decision of 2026-10-09): shown in its tab, selected,
   *  with the camera and the selection carried over, before the Time Machine is left — no board of
   *  now comes between, and the copy's layout of that build is the one on show (they lay out alike). */
  const saveVersion = async (snapshot: number): Promise<string | null> => {
    const why = await page.named();
    if (why) return why;
    const s = tm.snaps.find((x) => x.id === snapshot);
    const taken = new Set(views.summaries.map((v) => views.title(v.id)));
    // "Project @ Oct 9 22:27": the view's title at that build, numbered only where that is taken
    const name = versionName(views.title(nav.board.id), s ? briefWhen(s.at) : `build ${snapshot}`, taken);
    const r = await views.post("create", { name, from: nav.board.id, version: snapshot });
    if (r.who) page.people.lost();
    if (!r.view) return r.error ?? "The view could not be made.";
    const at = page.here();
    await views.load();
    const id = r.view.id;
    const ok = await tm.leaveFor(() => nav.show(id, at));
    page.sync.afterPost();
    if (!ok) return `“${name}” is made, kept at that build: it is in Views.`;
    // the tabs were hidden while it was shown: drawn again now, its tab brought into sight
    page.renderTabs();
    page.commit();
    return null;
  };

  return { stay, views, projectNotes, nav, vg, toView, toFull, cm, tm, pastShown, frozen, frozenWhy, openDerived, timeMachine, noSwitch, openTimeMachine };
}
