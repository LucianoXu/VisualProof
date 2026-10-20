// The page: load the graph, wire the toolbar, the canvas and the panels together, and — when a
// server is behind it — follow the project live: build status as it happens, a new graph when a
// build settles, swapped in place without losing what the reader was looking at.
//
// The canvas shows a view (ViewSpec.md): a board — its scope, clustering, pins and folds — shared
// with everyone on it, seen through the reader's own camera, selection and light-up. The page is
// divided as that line divides it: the side panel is the board, the bottom right the reader's eyes,
// the top their tabs and what they light up.
//
// Navigation never leaves the board (ViewSpec decision 27): a declaration gone to that the board does
// not hold shows on it as a visitor, the reader's own (web/src/visitors.ts), beside the declaration it
// was reached from; the board switches only when the reader asks.
//
// A board may show a past build (HistorySpec decisions 15–19): in the Time Machine, whose bar takes
// the tabs' place (web/src/timemachine.ts), or on a view kept at a past build. Its graph is then the
// one the board, the selection, the panel, the search and the review speak of (`g`), beside the graph
// on show (`present`). Such a board is arranged as any (the owner's decision of 2026-10-10); nothing
// is said in the review there, and its document is that build's. In the Time Machine at another build
// than the view's own it is a preview, which nothing arranges (`frozen`), and which Export prints at
// the build on show.
//
// The page is made in parts, one per concern (web/src/page*.ts), in the order this file makes them:
// what reads the store before the first paint, the stream's subscription once its handlers exist.
// What they share is the page (web/src/page.ts): what it is given here, the state they keep together,
// and what each part gives the others.

import type { FileStatus } from "../../shared/build.ts";
import type { ClusterMode, GitSource, Layout } from "../../shared/graph.ts";
import { lightUp, zoomScope } from "../../shared/board.ts";
import type { Lit } from "../../shared/board.ts";
import { printQuery, readsReview } from "../../shared/query.ts";
import { keyMarked, keyMarks } from "../../shared/review.ts";
import type { Query } from "../../shared/query.ts";
import { applyEvent, emptyReview, logFileName, problemsText, readEvent, validPersonId } from "../../shared/review.ts";
import type { ReviewChange, ReviewData, ReviewEvent, ReviewRequest, ReviewWhole } from "../../shared/review.ts";
import { reviewCount } from "../../shared/reviewqueue.ts";
import { briefWhen } from "../../shared/titles.ts";
import { fixedScope, PROJECT, versionName, viewFocus } from "../../shared/views.ts";
import { BoardPanel } from "./boardpanel.ts";
import { BoardSync } from "./boardsync.ts";
import { GraphCanvas } from "./canvas.ts";
import { ClusterPanel } from "./clusterpanel.ts";
import { dataSource } from "./data.ts";
import { WholeReview } from "./reviewread.ts";
import type { DataSource, ReviewState } from "./data.ts";
import { exactContext, judgedText } from "../../shared/context.ts";
import type { ModuleContexts } from "../../shared/context.ts";
import type { DeclarationText } from "../../shared/excerpt.ts";
import { Graph } from "../../shared/viewgraph.ts";
import { escapeHtml } from "./highlight.ts";
import { dragMoves } from "./drag.ts";
import { Notes } from "./notes.ts";
import { Stickies } from "./sticky.ts";
import { ProjectNotes } from "./projectnotes.ts";
import { Outline } from "./outline.ts";
import { Panel } from "./panel.ts";
import { READ_ONLY } from "./people.ts";
import { deployWaiting } from "./buildpop.ts";
import { githubBlob } from "../../shared/deploy.ts";
import { Editor } from "./editor.ts";
import { keptFocus, readerFocus } from "./focus.ts";
import { kindDot, ringed } from "./axiomring.ts";
import { holdTheme } from "./theme.ts";
import { besideSide, Popover } from "./popover.ts";
import { ReviewBox } from "./reviewbox.ts";
import { ReviewFlow } from "./reviewqueue.ts";
import { SelectionBar } from "./selbar.ts";
import { clusterIndex, clusterOn, clusterPick, declPick, remove, selectionQuery, shownOf } from "./selection.ts";
import type { KeysOf, Pick, Root, Tool } from "./selection.ts";
import { SourceWindow, sourceMemory } from "./sourcewin.ts";
import type { SourceHooks } from "./sourcewin.ts";
import { Sources } from "./sources.ts";
import { takeKept } from "./reload.ts";
import type { Kept } from "./reload.ts";
import { pairTop } from "./paperdock.ts";
import { Papers } from "./paperlinks.ts";
import { clusterSubject, fileOf, PAST_LINK } from "../../shared/library.ts";
import { snapshotIn } from "../../shared/sharesnap.ts";
import { decodeRecipe, readRecipe, recipeIn, resolveRecipe } from "../../shared/artrecipe.ts";
import { STATUS_LABEL, STATUSES } from "./status.ts";
import { ChatWindow, keepStripClear } from "./chatwin.ts";
import { noteIn, siteOrigins } from "./chatlinks.ts";
import { LinearForm } from "./linear.ts";
import { isPhone, isTall, Phone, tallInsets } from "./phone.ts";
import { MonitorLayout, monitorInsets } from "./monitor.ts";
import { ArtFrame } from "./artframe.ts";
import type { ArtSettings } from "./artwork.ts";
import { sourceLine, titleOf, untilStill } from "./artwork.ts";
import { SHIELD, Trust } from "./trust.ts";
import { decodeState, encodeState, tipsIn } from "./state.ts";
import { Store } from "./store.ts";
import { ViewNav } from "./viewnav.ts";
import type { Place } from "./viewnav.ts";
import { Views } from "./views.ts";
import { LayoutQueue } from "./layoutqueue.ts";
import type { LayoutWorker } from "./layoutqueue.ts";
import type { Board } from "./views.ts";
import { buildWhen, TimeMachine } from "./timemachine.ts";
import type { TimeMachineAt } from "./timemachine.ts";
import { boardMarks, markWords, PAST_CHANGED, PAST_GHOST, PAST_RENAMED, reviewThen } from "./past.ts";
import type { PastGraph } from "./past.ts";
import { $, TAP_HINT, VIEW_GONE, STATE_LABEL, PAST_REVIEW, READ_ONLY_REVIEW, short } from "./page.ts";
import type { GraphInfo, Page } from "./page.ts";
import { schemePart } from "./pagescheme.ts";
import { followPart } from "./pagefollow.ts";
import { talkPart } from "./pagetalk.ts";
import { peoplePart } from "./pagepeople.ts";
import { tabsPart } from "./pagetabs.ts";
import { sharePart } from "./pageshare.ts";
import { timelinePart } from "./pagetimeline.ts";
import { selectionPart } from "./pageselection.ts";
import { addressPart } from "./pageaddress.ts";
import { livePart } from "./pagelive.ts";
import { toolbarPart } from "./pagetoolbar.ts";
import { menuPart } from "./pagemenu.ts";
import { notesPart } from "./pagenotes.ts";
import { keysPart } from "./pagekeys.ts";
import { guidePart } from "./pageguide.ts";

/** What main.ts makes that the parts written so far read (until each is a part of its own). */
export interface MainPart {
  selected: () => number | null;
  boardReview: () => ReviewData;
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
  edits: Map<string, boolean>;
  served: Map<string, string[] | null>;
  servedContexts: Map<string, { contexts: ModuleContexts | null; hash: string | null }>;
  submit: (op: ReviewRequest) => Promise<string | null>;
  flow: ReviewFlow;
  flowNow: ReviewFlow;
  blocked: () => string | null;
  isTarget: (name: string) => boolean;
  heldTargets: () => string[];
  linkedTargets: () => string[];
  viewFocusName: () => string | null;
  reviewName: () => string | null;
  reviewRoot: () => number | null;
  keysFor: (r: Root, target?: string | null) => KeysOf;
  pickDecl: (name: string, target?: string | null) => Pick;
  pickCluster: (c: number) => Pick;
  reviewBox: ReviewBox;
  declNow: (i: number) => string;
  clickedDecls: () => number[];
  keyMarking: () => { target: string; fresh: number; already: number; names: string[] } | null;
  toggleKey: (i?: number | null) => void;
  litOn: (q: Query) => Lit;
  zoomOf: (q: Query | null, lit?: Lit | null) => Query | null;
  papers: Papers;
  panel: Panel;
  selBar: SelectionBar;
  sources: Sources<SourceWindow>;
  openSourceAt: (name: string, from: number, to: number, quoted: string[] | null, at: HTMLElement | null) => void;
  shownCluster: () => number;
  showSelected: () => void;
  canvas: GraphCanvas;
  ownOpen: Map<string, boolean>;
  stickies: Stickies;
  linear: LinearForm;
  ART_KEYS: Set<string>;
  art: ArtFrame;
  artReach: () => void;
  shut: (section: string) => boolean;
  toggleSection: (section: string) => void;
  trust: Trust;
  boardPop: Popover;
  trustPop: Popover;
  files: () => Map<string, FileStatus>;
  outline: Outline;
  boardPanel: BoardPanel;
  sync: BoardSync;
  hideLevel: (key: string) => void;
  chatWin: ChatWindow;
  syncInsets: () => void;
  renderStrip: () => void;
  syncFocus: () => void;
  openRecipe: (link: { text: string; save: ("png" | "svg")[] }) => Promise<void>;
  timeMachine: (at?: TimeMachineAt) => void;
  wholeReview: WholeReview<ReviewWhole>;
  takeChange: (c: ReviewChange) => void;
  say: (text: string) => void;
  noSwitch: () => boolean;
  openTimeMachine: (at?: TimeMachineAt) => Promise<boolean>;
}

/** Wait until the server has a graph: what it is, and the server's "Open in editor" template. */
async function waitReady(data: DataSource): Promise<{ graph: GraphInfo | null; editor: string | null; publicUrl: string | null }> {
  const log = $("#loader-log");
  for (;;) {
    const st = await data.status();
    log.textContent = (st.log ?? []).slice(-8).join("\n");
    if (st.state === "ready") return { graph: (st as { graph?: GraphInfo }).graph ?? null, editor: st.editor ?? null, publicUrl: st.publicUrl ?? null };
    // a server that builds what it shows (DeploySpec decision 7) says what it is doing, and what
    // failed, until a build can be read: never a dead end
    if (st.deploy) {
      const w = deployWaiting(st.deploy, { state: st.state, error: st.error, progress: st.build?.progress ?? null });
      $("#loader-title").textContent = w.title;
      if (w.log !== null) log.textContent = w.log;
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    if (st.state === "error") {
      $("#loader-title").textContent = "Could not read the project";
      log.textContent = st.error ?? "";
      throw new Error(st.error);
    }
    await new Promise((r) => setTimeout(r, 700));
  }
}

async function boot(): Promise<void> {
  const data = dataSource();
  const ready = await waitReady(data);
  const graphInfo = ready.graph;
  // the graph's two parts, the review and the build status, at once: a page far from the server
  // waits on each
  const reviewing = data.review().catch((): ReviewState => ({ epoch: "", rev: 0, data: emptyReview(), problems: [], error: "The review could not be loaded." }));
  const firstBuild = data.snapshot ? null : data.build();
  firstBuild?.catch(() => {});
  const [meta, edges0] = await Promise.all([data.meta(graphInfo?.version, graphInfo?.instance), data.edges(graphInfo?.version, graphInfo?.instance)]);
  const present = new Graph(meta, new Int32Array(edges0));
  const store = new Store(meta.project.root);
  const S = store.data;
  /** what this page held before it reloaded into its server's new version (web/src/reload.ts) */
  const kept: Kept | null = data.snapshot ? null : takeKept(meta.project.root);
  /** a read-only reader's page (CollabSpec decision 11): how it was let in, known before anything is
   *  set up; null for any other page. It changes nothing that is shared and offers nothing that would. */
  const reader: "link" | "public" | null = data.snapshot ? null : ((await data.identity()).readOnly?.by ?? null);
  const editor = new Editor(store, ready.editor);
  /** this site's addresses (CollabSpec, "Copied links"): the page's own, and the one people reach
   *  the server at (`--public-url`), whose links are this site's too and with which the page makes
   *  its own, as agents and Share do */
  const site = siteOrigins(location.origin, ready.publicUrl);
  document.title = `${meta.project.name} — VisualProof`;
  $("#project").textContent = meta.project.name;
  if (data.snapshot) {
    const tag = $("#snapshot");
    tag.textContent = `${data.snapshot.label} · snapshot ${new Date(data.snapshot.createdAt).toLocaleDateString()}`;
    tag.title = `A frozen copy, taken ${new Date(data.snapshot.createdAt).toLocaleString()}. It does not update.`;
    tag.hidden = false;
  } else if (reader) {
    const tag = $("#snapshot");
    tag.textContent = "read-only";
    tag.title = "You see this project, its review and its history as they are, live, and change nothing that is shared. Nobody sees you here.";
    tag.hidden = false;
  }
  // the page its parts share (web/src/page.ts): what it is given, above, and the state they keep
  // together as it starts — the graph read, nothing selected, the review once it is read
  const page = {
    data,
    store,
    S,
    kept,
    reader,
    editor,
    site,
    graphInfo,
    firstBuild,
    meta,
    present,
    g: present,
    // tips in place (GuideSpec decision 9; web/src/intip.ts): the moments the page tells of, before the
    // guide is made; and the release the server runs (UpdateSpec), as its event stream says it
    offerTip: (_rule: string): void => {},
    didTip: (_rule: string): void => {},
    countTip: (_name: string, _rule: string): number => 0,
    heardRelease: null,
    hearRelease: (v: string): void => void (page.heardRelease = v),
    readOnlyLinks: false,
    picks: [],
    shown: null,
    visitors: [],
    build: null,
    deploy: null,
    showLevel: () => {},
    setEdges: (_edges: boolean): void => {},
    review: await reviewing,
    // whether a layout's memory can be handed over now (web/src/views.ts): known once the people are
    handsOver: (): boolean => false,
    // the rest each part sets as it is made
  } as Partial<Page> as Page;
  /** the declaration the panel tells of, in the whole graph's numbering, or null */
  const selected = (): number | null => (page.shown && "decl" in page.shown ? page.g.byName.get(page.shown.decl) ?? null : null);
  page.selected = selected;
  let visitorsOn = "";
  /** while something is said where the hint is (`say`), until it goes */
  let saying: ReturnType<typeof setTimeout> | null = null;
  /** The review as the board on show reads it, by its declarations' names: on a past graph, what was
   *  said of a declaration renamed since — kept under its name now — is read under its name then too
   *  (web/src/past.ts, reviewThen), made once per revision of the review and past graph. */
  let readThen: { data: ReviewData; rev: number; past: PastGraph; out: ReviewData } | null = null;
  const boardReview = (): ReviewData => {
    const past = nav.board?.past?.past;
    if (!past || !past.nowName.size) return page.review.data;
    if (readThen?.data !== page.review.data || readThen.rev !== page.review.rev || readThen.past !== past) readThen = { data: page.review.data, rev: page.review.rev, past, out: reviewThen(page.review.data, past.nowName) };
    return readThen.out;
  };
  page.boardReview = boardReview;

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
  page.stay = stay;
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
  page.views = views;
  await views.load();
  // the project's notes (AttachmentSpec decision 13): every one, whichever board is on show
  const projectNotes = new ProjectNotes(data.views, () => page.people?.stream ?? null);
  page.projectNotes = projectNotes;
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
  page.nav = nav;
  const vg = () => nav.board.graph;
  page.vg = vg;
  const toView = (i: number) => nav.board.toView(i);
  page.toView = toView;
  const toFull = (j: number) => nav.board.toFull(j);
  page.toFull = toFull;
  /** the board's clustering */
  const cm = (): ClusterMode => nav.board.rec.clustering;
  page.cm = cm;

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
    say: (text) => say(text),
    keep: async (snapshot) => {
      if (reader) return READ_ONLY;
      if (!(await page.people.ensureLayout())) return "Keeping a build in a view is recorded under your name: give one first.";
      const why = await sync.keepVersion(snapshot);
      page.renderTabs();
      return why;
    },
    saveAs: (snapshot) => saveVersion(snapshot),
    frozen: () => (reader ? READ_ONLY : null),
    following: () => page.people.following,
    newBuild: (from, to) => void page.newBuild(from, to),
  });
  page.tm = tm;
  /** The board on show is of a past graph: a view kept at a past build, or the Time Machine's. It is
   *  a board as any other (the owner's decision of 2026-10-10), but for the review: a past build is
   *  not reviewed. Its document is that build's (ExportSpec decision 16). */
  const pastShown = (): boolean => !!nav.board?.past;
  page.pastShown = pastShown;
  /** The board on show is a preview of its view at another build than its own (web/src/views.ts,
   *  `preview`): the Time Machine browsing it, or its build while that cannot be read. Nothing
   *  arranges it there: the view's own board is another. */
  const frozen = (): boolean => !!reader || (!data.snapshot && !!nav.board?.preview);
  page.frozen = frozen;
  /** Why arranging was refused there, in words. */
  const frozenWhy = (): string =>
    reader
      ? READ_ONLY
      : tm.active
      ? "The Time Machine shows this view at another build than its own: Keep this version, or Save as new view, to arrange it."
      : "This view's build could not be read: it is shown at the latest build, and is arranged once its own build shows.";
  page.frozenWhy = frozenWhy;
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
  const openDerived = async (scope: string, to: Place | null, clustering?: ClusterMode, focus: string | null = viewFocusName()): Promise<boolean | string> => {
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
  page.openDerived = openDerived;
  // which modules' present text is not the text the graph was read from (its declarations' places,
  // statements and hashes are about the compiled one): found out from the served source's hash
  page.compiled = new Map(page.meta.modules.map((m) => [m.name, m.compiled]));
  const edits = new Map<string, boolean>();
  page.edits = edits;
  // the lines of each file read with it (null where it could not be read): what an opinion
  // records, and what a stale one is compared with; and the usage pass's contexts of that text,
  // where it has them (shared/context.ts)
  const served = new Map<string, string[] | null>();
  page.served = served;
  const servedContexts = new Map<string, { contexts: ModuleContexts | null; hash: string | null }>();
  page.servedContexts = servedContexts;
  const editedNow = (i: number): boolean | null => (page.g.isExt(i) ? false : edits.get(page.g.nodes[i].module) ?? null);
  const edited = async (i: number): Promise<boolean> => {
    if (page.g.isExt(i)) return false;
    const mod = page.g.nodes[i].module;
    const known = edits.get(mod);
    if (known !== undefined) return known;
    const c = page.compiled.get(mod);
    const src = await data.source(mod);
    const e = !!c && !!src?.hash && src.hash !== c;
    edits.set(mod, e);
    served.set(mod, src ? src.text.split("\n") : null);
    servedContexts.set(mod, { contexts: src?.contexts ?? null, hash: src?.hash ?? null });
    return e;
  };
  /** A declaration's text as the source window shows it, with the context it is written in above
   *  it: what an opinion records (shared/context.ts), and what a stale one is compared with;
   *  undefined until its file has been read. */
  const textNow = (i: number): DeclarationText | null | undefined => {
    const v = page.g.nodes[i];
    if (page.g.isExt(i) || !v.range) return null;
    const lines = served.get(v.module);
    const e = edits.get(v.module);
    if (lines === undefined || e === undefined) return undefined;
    const c = servedContexts.get(v.module);
    return lines && judgedText(lines, e, v.name, v.range, exactContext(c?.contexts, v.name, c?.hash));
  };

  /** Record something in the review; resolves to why it was refused, or null. The answer carries
   *  the change, applied at once (the reader sees their board follow); the event that tells every
   *  page the same change is then known and skipped. */
  const submit = (op: ReviewRequest): Promise<string | null> =>
    // a past build is not reviewed: the review is given on the graph of now
    pastShown() ? Promise.resolve(PAST_REVIEW) : data.postReview(op).then(
      (c) => {
        if (c) takeChange(c);
        tipsOnReview(op);
        return null;
      },
      (e: Error & { who?: boolean }) => {
        // the server no longer knows this page's name: it is asked for again on the next try
        if (e.who) page.people.lost();
        return e.message;
      },
    );
  page.submit = submit;

  // the review flow where the review has a focus (ViewSpec decision 28): the focus's review set in
  // review order, the next one to review, why a declaration is in it (web/src/reviewqueue.ts)
  const flow = new ReviewFlow({ graph: () => page.g, review: () => boardReview(), reader: () => page.people.name });
  page.flow = flow;
  /** The same on the graph on show, whatever build the board shows: how far each target's review has
   *  come is the review's now (the targets list, the views menu) */
  const flowNow = new ReviewFlow({ graph: () => page.present, review: () => page.review.data, reader: () => page.people.name });
  page.flowNow = flowNow;
  /** Why this reader's opinions are refused until their log is fixed by hand (a line of it cannot
   *  be read, server/review.ts), or null. */
  const blocked = (): string | null => {
    const me = page.people.name?.trim();
    if (!me) return null;
    // someone invited by a personal link writes to their link's log (CollabSpec decision 9)
    const mine = logFileName(me, false, page.people.person?.id ?? null);
    const p = page.review.problems.find((x) => x.file === mine);
    return p ? `Your review log (log/${mine}) has a line that cannot be read — line ${p.line}: ${p.why}. Nothing more is written to it until it is fixed by hand.` : null;
  };
  page.blocked = blocked;
  const isTarget = (name: string): boolean => Object.hasOwn(boardReview().targets, name);
  page.isTarget = isTarget;
  /** The targets the board on show holds, by name. */
  const heldTargets = (): string[] =>
    Object.keys(boardReview().targets)
      .filter((n) => {
        const i = page.g.byName.get(n);
        return i !== undefined && toView(i) >= 0;
      })
      .sort();
  page.heldTargets = heldTargets;
  /** The targets linked to the view on show (ViewSpec decision 29), in the order they were linked. */
  const linkedTargets = (): string[] => (nav.board?.rec.targets ?? []).filter(isTarget);
  page.linkedTargets = linkedTargets;
  /** The view's own focus, everyone's (shared/views.ts, viewFocus). */
  const viewFocusName = (): string | null => (nav.board ? viewFocus(nav.board.rec, isTarget, heldTargets) : null);
  page.viewFocusName = viewFocusName;
  /** The target the review is on for this reader (ViewSpec decision 28): their own focus where they
   *  chose one, else the view's; null where there is none, and the review strip and its keys stand
   *  aside. */
  const reviewName = (): string | null => (nav.board ? readerFocus(page.mine, viewFocusName(), isTarget, [...linkedTargets(), ...heldTargets()]) : null);
  page.reviewName = reviewName;
  /** The same in the whole graph's numbering. */
  const reviewRoot = () => {
    const t = reviewName();
    return t === null ? null : page.g.byName.get(t) ?? null;
  };
  page.reviewRoot = reviewRoot;
  /** Whose key declarations a Keys pick of `r` holds (ViewSpec decision 20) where the review's focus
   *  is `target` (by default the board on show's): that target's; elsewhere a target's own when the
   *  target itself is clicked — a click on a target selects it and its key declarations — and every
   *  target's for anything else. */
  const keysFor = (r: Root, target: string | null = reviewName()): KeysOf =>
    target ?? ("decl" in r && Object.hasOwn(boardReview().targets, r.decl) ? r.decl : null);
  page.keysFor = keysFor;
  /** A declaration clicked with the tool, on the board on show or (`target`) on another. */
  const pickDecl = (name: string, target?: string | null): Pick => declPick(S.mode, name, keysFor({ decl: name }, target));
  page.pickDecl = pickDecl;
  /** A cluster of the board clicked with the tool. */
  const pickCluster = (c: number): Pick => {
    const cl = canvas.layout.clusters[c];
    return clusterPick(S.mode, cl, cm(), keysFor({ cluster: cl.key, by: cm() }));
  };
  page.pickCluster = pickCluster;
  /** The Selection tool, nothing selected again (walking a TCB chooses it). */
  const toSelection = () => {
    if (S.mode === "plain") return;
    S.mode = "plain";
    store.save();
    page.syncTool();
  };
  /** Walking a target's TCB (a row of its review list, the strip's target): the declaration alone,
   *  under the Selection tool whatever the tool was (ViewSpec decision 15); Rests on or Used by then
   *  show it and the rest of the board. */
  const walk = (i: number) => {
    toSelection();
    page.go(i);
  };

  const reviewBox = new ReviewBox(page.g, {
    review: () => ({
      data: boardReview(),
      error: page.review.error,
      blocked: blocked(),
      readOnly: !!data.snapshot || pastShown() || !!reader,
      ...(pastShown() ? { note: `Today's review, against this build. ${PAST_REVIEW}` } : reader ? { note: READ_ONLY_REVIEW } : {}),
      reviewer: page.people.name,
      // someone invited by a personal link is their link (CollabSpec decision 9): their opinions
      // are told by it, as Withdraw finds them
      person: page.people.person?.id ?? null,
    }),
    ensureReviewer: () => page.people.ensure(),
    submit,
    said: (text) => say(text),
    queue: (i) => flow.queue(i),
    progress: (i) => flow.progress(i),
    reviewLens: (i) => page.reviewTarget(i),
    // the view the target is linked to (ViewSpec decision 29), or none, and linking it to the view
    // on show
    targetView: (i) => {
      const name = declNow(i);
      if (!isTarget(name)) return null;
      const id = views.linkedTo(name);
      return { title: id === undefined ? null : views.title(id), here: id === nav.board.id, why: page.linkWhy(name) };
    },
    linkHere: (i) => void page.linkTo(declNow(i)).then((why) => why && say(why)),
    editedNow,
    edited,
    textNow,
    text: async (i) => {
      await edited(i);
      return textNow(i) ?? null;
    },
    reviewRoot: () => reviewRoot(),
    keyable: (r, i) => flow.keyable(r, i),
    isKey: (r, i) => flow.isKey(r, i),
    keyProgress: (i) => flow.keyProgress(i),
    // a view made from the board on show: at its build, leaving the Time Machine for it; focused on
    // the target it is made from (ViewSpec decision 28). A read-only reader makes no views, and is
    // not offered one (CollabSpec decision 11)
    ...(reader
      ? {}
      : {
          keyView: (i: number) => {
            void openDerived(printQuery({ op: "key", of: [declNow(i)] }), null, undefined, declNow(i)).then((ok) => {
              if (ok === true) page.commit();
              else if (typeof ok === "string") say(ok);
            });
          },
        }),
    go: (i) => page.go(i),
    openSource: (name, from, to, quoted, root) => openSourceAt(name, from, to, quoted, root),
  });
  page.reviewBox = reviewBox;
  if (kept) reviewBox.restoreDrafts(kept.review);
  /** What declaration `i` of the board's graph is called now: on a past graph, the name a rename
   *  since gave it, which the review, the views' records and their scopes speak (HistorySpec decision
   *  8); else its name. */
  const declNow = (i: number): string => nav.board?.past?.past.nowName.get(page.g.nodes[i].name) ?? page.g.nodes[i].name;
  page.declNow = declNow;
  /** The declarations clicked (the selection's picks' roots), in the whole graph's numbering. */
  const clickedDecls = (): number[] =>
    page.picks.flatMap((p) => {
      const j = p.root && "decl" in p.root ? page.g.byName.get(p.root.decl) : undefined;
      return j === undefined ? [] : [j];
    });
  page.clickedDecls = clickedDecls;
  /** What "Mark selected as key" would mark where the review has a focus (web/src/selbar.ts): the
   *  declarations clicked that the focus's TCB holds, trusted or not (ExportSpec decision 1), not key
   *  yet; null where there is no focus. */
  const keyMarking = () => {
    const r = reviewRoot();
    // a past build is not reviewed: the review box says so
    if (r === null || data.snapshot || pastShown() || reader) return null;
    const xs = clickedDecls().filter((j) => flow.keyable(r, j));
    const already = xs.filter((j) => flow.isKey(r, j)).length;
    return { target: page.g.short(r), fresh: xs.length - already, already, names: xs.filter((j) => !flow.isKey(r, j)).map((j) => page.g.nodes[j].name) };
  };
  page.keyMarking = keyMarking;
  /** Mark or unmark a declaration as key for the focus (k): the one in the panel, or in the source
   *  window the key was pressed in. */
  const toggleKey = (i = selected()) => {
    const r = reviewRoot();
    if (r === null || i === null || i === r || data.snapshot) return;
    if (reader) return say(READ_ONLY);
    if (pastShown()) return say(PAST_REVIEW);
    if (!flow.keyable(r, i)) return say(`${page.g.short(i)} is not in ${page.g.short(r)}'s TCB: only what it holds can be key for it.`);
    const target = page.g.nodes[r].name;
    void page.people.ensure().then((me) => {
      if (!me) return;
      void submit({ op: "key", target, name: page.g.nodes[i].name, on: !keyMarked(page.review.data, target, page.g.nodes[i].name) }).then((why) => why && say(why));
    });
  };
  page.toggleKey = toggleKey;

  /** What a query lights up on the board on show: computed on the whole graph the board was taken
   *  from, then cut to what the board holds (shared/board.ts, lightUp). */
  const litOn = (q: Query): Lit => lightUp(nav.board.full, boardReview(), nav.board.bs, q);
  page.litOn = litOn;
  /** Zoom in (ViewSpec decision 13): the scope of a view of what `q` lights up on this board, which
   *  holds exactly that; null when it would hold nothing, or just what this board holds. */
  const zoomOf = (q: Query | null, lit: Lit | null = q && litOn(q)): Query | null =>
    q && lit && zoomScope(q, nav.board.rec.scope, lit, nav.board.bs);
  page.zoomOf = zoomOf;

  /** Where the lead from the selection meets the panel: its left edge, level with the
   *  declaration's name while that is in sight; null while the panel is away. */
  const leadEnd = (): { x: number; y: number } | null => {
    const el = $("#panel");
    if (!el.classList.contains("open")) return null;
    const r = el.getBoundingClientRect();
    const t = el.querySelector(".p-name")?.getBoundingClientRect();
    const y = t ? t.top + t.height / 2 : r.top + 48;
    return { x: r.left, y: Math.min(Math.max(y, r.top + 18), r.bottom - 18) };
  };
  // the name moves with the panel's scroll, and the lead with it
  $("#panel").addEventListener("scroll", () => canvas.request(), { passive: true });

  // the library and the reference window (AttachmentSpec.md; web/src/paperlinks.ts): the links a panel
  // lists, the pairing with the source window, the window shown to those who follow
  const papers: Papers = new Papers($("#windows"), $("#library-btn"), $("#library-pop"), $("#panel"), {
    review: () => boardReview(),
    takeChange: (c) => takeChange(c),
    graph: () => page.g,
    clustering: () => cm(),
    boardSubject: () => (page.shown && "decl" in page.shown ? `decl(${page.shown.decl})` : page.shown && "cluster" in page.shown ? clusterSubject(page.shown.cluster, cm()) : null),
    // a past build is not reviewed, and links are part of the review (ViewSpec decision 26)
    cannotLink: () => (data.snapshot ? "A snapshot of the page shows the links as they were: they are made on the server." : reader ? READ_ONLY : pastShown() ? PAST_LINK : null),
    goDecl: (name) => {
      const i = page.g.byName.get(name) ?? page.g.foldedInto.get(name);
      if (i === undefined) say(`${name} is not in the graph on show.`);
      else page.go(i);
    },
    goCluster: (kind, key) => {
      if ((kind === "file") !== (cm() === "module")) return say(`${key} is a cluster by ${kind === "file" ? "file" : "namespace"}: this board is clustered by ${cm() === "module" ? "file" : "namespace"}.`);
      const c = clusterIndex(canvas.layout, key);
      if (c < 0) say(`${key} is not a cluster of this board.`);
      else page.goCluster(c);
    },
    headers: () => ({ "content-type": "application/json", ...(data.name ? { "x-visualproof-name": encodeURIComponent(data.name) } : {}), ...(data.privateSession ? { "x-visualproof-private": data.privateSession } : {}) }),
    ensureName: async () => (await page.people.ensure()) !== null,
    following: () => page.people.followedName,
    changed: () => page.people.report(),
    say: (text) => say(text),
    relayoutSource: () => sources.following?.relayout(),
    repaint: () => showSelected(),
    readOnly: () => (data.snapshot ? "A snapshot of the page carries no library: its files are on the server." : reader ? READ_ONLY : null),
    noFiles: () => (data.snapshot ? "A snapshot of the page carries the library's records and links, not its files: open it on the server." : null),
    // what notes carry (AttachmentSpec decision 12): a clip made into a note, a file attached to one
    cannotNote: () => page.noteRefused(),
    clip: (c, text) => page.clipToNote(c, text),
    attach: (note, c) => page.attachTo(note, c),
  });
  page.papers = papers;

  const panel = new Panel($("#panel"), page.g, reviewBox, {
    links: (i) => papers.declHtml(i),
    go: (i) => page.go(i),
    walk: (i) => walk(i),
    reviewData: () => boardReview(),
    openSource: (i) => void sources.show(i),
    preview: (i) => canvas.preview(i === null || toView(i) < 0 ? null : toView(i)),
    unpin: (i) => {
      if (toView(i) < 0) return;
      canvas.unpin(toView(i));
      sync.sharePins();
    },
    isPinned: (i) => !frozen() && toView(i) >= 0 && canvas.isPinned(toView(i)),
    close: () => {
      page.clear();
      page.commit();
    },
    // a past build's files are not the build status of now
    fileOf: (i) => (pastShown() ? undefined : page.fileIndex.get(page.g.nodes[i].module)),
    alsoHere: (i) => {
      const on = page.people.on(page.g.nodes[i].name);
      if (!on.length) return "";
      return (
        `<span>Also here:</span>` +
        on.map((p) => `<span class="avatar${p.agent ? " agent" : ""}" style="background:${page.people.colorOf(p)}" title="${escapeHtml(page.people.nameOf(p))}">${escapeHtml(page.people.label(p))}</span>`).join("") +
        `<span>${escapeHtml(on.map((p) => page.people.nameOf(p)).join(", "))}</span>`
      );
    },
    why: (i) => {
      const r = reviewRoot();
      return r === null ? "" : flow.whyHtml(r, i);
    },
    queue: (i, keyOnly) => (flow.isTarget(i) ? flow.listHtml(i, keyOnly) : null),
    listOrder: () => S.tcbOrder ?? "review",
    setListOrder: (o) => {
      S.tcbOrder = o;
      store.save();
    },
    editorLink: (i) => editor.href(page.g, i),
    shut: (section) => store.isShut(section),
    toggle: (section) => store.toggleShut(section),
    then: (i) => thenHtml(i),
  });
  page.panel = panel;
  /** What the panel says of a declaration of a past graph (HistorySpec decision 17): the build it
   *  is shown at, whether its source then is kept (decision 23), and what became of it since. */
  const thenHtml = (i: number): string | null => {
    const past = nav.board?.past?.past;
    if (!past || page.g !== past.graph) return null;
    const s = past.snapshot;
    const m = past.marks[i] ?? 0;
    const kept = page.g.isExt(i) || !page.g.nodes[i].range ? null : past.kept.get(page.g.nodes[i].module);
    const then = page.g.isExt(i) || !page.g.nodes[i].range ? "its statement and doc then." : kept ? "its statement, doc and source then (Space)." : "its statement and doc then; its source then is not kept.";
    const now = past.nowName.get(page.g.nodes[i].name);
    const what =
      m & PAST_GHOST
        ? "Gone now: no rename since carried it."
        : [m & PAST_RENAMED ? `Renamed since: now <code>${escapeHtml(now ?? "")}</code>.` : "", m & PAST_CHANGED ? "Changed since: another version now." : ""].filter(Boolean).join(" ");
    return (
      `<div class="banner tm-then"><b>As built ${escapeHtml(buildWhen(s.at))}</b>${s.commit ? ` · <code>${escapeHtml(s.commit.hash.slice(0, 7))}</code>` : ""}: ` +
      `${then}${what ? `<div class="tm-then-m">${what}</div>` : ""}</div>`
    );
  };

  // a cluster's panel, in the same place (web/src/clusterpanel.ts)
  const clusterPanel = new ClusterPanel($("#panel"), {
    board: () => ({ graph: vg(), layout: canvas.layout, mode: cm(), toFull }),
    reviewData: () => boardReview(),
    isFolded: (c) => canvas.folded.has(c),
    toggleFold: (c) => canvas.toggleFold(c),
    goCluster: (c) => page.goCluster(c),
    go: (i) => page.go(i),
    preview: (i) => canvas.preview(i === null || toView(i) < 0 ? null : toView(i)),
    previewCluster: (c) => canvas.previewCluster(c),
    zoom: (c) => void page.zoomCluster(c),
    canZoom: (c) => !reader && page.clusterScope(c) !== null,
    hide: (c) => hideLevel(canvas.layout.clusters[c].key),
    trust: (c) => trust.state(canvas.layout.clusters[c], cm()),
    trustClicked: (c, anchor) => trust.clicked(canvas.layout.clusters[c], cm(), anchor),
    // a past build's files are not the build status of now, and its modules are its graph's
    fileOf: (m) => (pastShown() ? undefined : page.fileIndex.get(m)),
    stateLabel: (st) => STATE_LABEL[st],
    modulesUnder: (prefix) => page.g.meta.modules.filter((m) => m.name === prefix || m.name.startsWith(prefix + ".")).map((m) => m.name),
    goToModule: (m) => page.goToModule(m),
    close: () => {
      page.clear();
      page.commit();
    },
    links: (key, mode) => papers.clusterHtml(key, mode),
  });

  // the selection, under the mode buttons (web/src/selbar.ts)
  const selBar = new SelectionBar($("#selbar"), {
    canOpenViews: () => !reader,
    names: () => views.titles().names ?? undefined,
    show: (k) => {
      const to = shownOf(page.picks[k]);
      if (!to) return;
      page.shown = to;
      page.apply();
      page.revealShown();
      page.commit();
    },
    remove: (k) => {
      ({ picks: page.picks, shown: page.shown } = remove(page.picks, page.shown, k));
      page.apply();
      page.commit();
    },
    zoom: () => void page.zoomIn(),
    clear: () => {
      page.clear();
      page.commit();
    },
    markKeys: () => {
      const m = keyMarking();
      if (m) void reviewBox.markKeys(m.names).then((why) => why && say(why));
    },
  });
  page.selBar = selBar;

  // the source windows (ReviewSpec, "The source window"; web/src/sources.ts): the one that follows
  // the selection, opened in the middle of the screen each time, and those the reader pinned; a
  // reload starts without them
  const viewport = () => ({ w: document.documentElement.clientWidth || innerWidth, h: document.documentElement.clientHeight || innerHeight });
  page.steps = { back: false, forward: false };
  // the source windows are of the graph on show (`useGraph`): on a board of a past build, they show
  // the text that build was compiled from (HistorySpec decision 23)
  const sourceHooks: SourceHooks = {
    go: (name) => {
      const j = page.g.byName.get(name);
      if (j !== undefined) page.go(j);
    },
    // a past build's files are not the build status of now
    fileOf: (m) => (pastShown() ? undefined : page.fileIndex.get(m)),
    compiledOf: (m) => page.compiled.get(m),
    close: (w) => sources.close(w),
    pin: (w) => void sources.pin(w),
    // a source window collapsed or opened again leaves or takes its side of the reference window
    // paired with it, the two kept apart as the pairing shows them (AttachmentSpec decision 8)
    collapsed: () => {
      page.people.report();
      papers.redock();
    },
    back: () => history.back(),
    forward: () => history.forward(),
    steps: () => page.steps,
    editorLink: (G, i, at) => editor.href(G, i, at),
    // following a branch on GitHub (DeploySpec decision 13): the build's lines there
    githubLink: (file, commit, from, to) => (page.deploy?.github ? githubBlob(page.deploy.github, commit, file, from, to) : null),
    builtCommit: () => page.graphInfo?.commit ?? null,
    pinned: () => sources.pinned.map((p) => p.rect()),
    top: () => pairTop(),
    say: (text) => say(text),
    pastOf: (G) => {
      const past = nav.board?.past?.past;
      return past && past.graph === G ? { past, when: buildWhen(past.snapshot.at) } : null;
    },
    // the reference window paired with a source window stands beside it, on the right of the two
    docked: (w) => papers.dockFor(w),
  };
  const memory = sourceMemory();
  const sources: Sources<SourceWindow> = new Sources({
    make: () => new SourceWindow($("#windows"), page.g, data, reviewBox, sourceHooks, memory),
    say: (text) => say(text),
    // what the others are told changed: at once, not at the next look
    changed: () => {
      page.people.report();
      papers.redock();
    },
    viewport,
    // a pinned window stands under the page's bars, as the paired windows do
    top: () => pairTop(),
    // the reference window opens the declaration's first link beside the window opened or stepped,
    // pinned or not (AttachmentSpec decision 8)
    shown: (w, i) => papers.paired(i, w),
  });
  page.sources = sources;

  /** Open declaration `name`'s source at lines `from`–`to` of its file (a code quote's header in a
   *  comment, clicked in `at`; ReviewSpec, "Comments"): in a window that shows it already — the one
   *  clicked in, else any — and else in the following window, the declaration gone to first; the
   *  lines are scrolled to and flashed there. */
  const openSourceAt = (name: string, from: number, to: number, quoted: string[] | null, at: HTMLElement | null) => {
    const j = page.g.byName.get(name) ?? page.g.foldedInto.get(name);
    if (j === undefined) return say(`${name} is not in the graph now.`);
    const here = at ? sources.at(at) : null;
    let w = here?.decl === j ? here : sources.all.find((p) => p.decl === j) ?? null;
    if (w) sources.reveal(w);
    else {
      if (selected() !== j) page.go(j);
      w = sources.show(j);
    }
    w.showLines(from, to, quoted);
  };
  page.openSourceAt = openSourceAt;

  /** The cluster the panel tells of, in the board's layout (its key read in the board's
   *  clustering); -1 when it tells of none, or of one this board does not hold. */
  const shownCluster = (): number => (page.shown && "cluster" in page.shown && canvas.layout ? clusterIndex(canvas.layout, page.shown.cluster) : -1);
  page.shownCluster = shownCluster;

  /** The panel for what was last clicked — a cluster's (web/src/clusterpanel.ts), or a
   *  declaration's with the source window following it; and once it is known whether the
   *  declaration's file changed since it was compiled, both again if it did, or if a stale opinion
   *  on it is waiting for its text to show what changed. */
  const showSelected = () => {
    // what the panel tells of has no card on the canvas: a lead from it to the panel instead
    const c = shownCluster();
    if (c >= 0) {
      panel.hide();
      sources.follow(null);
      sources.redrawReviews();
      clusterPanel.show(c);
      canvas.setLead({ kind: "cluster", c }, leadEnd);
      return;
    }
    clusterPanel.hide();
    const i = selected();
    panel.show(i);
    sources.follow(i);
    sources.redrawReviews();
    const k = i === null ? -1 : page.visitorOf(i);
    canvas.setLead(i !== null && toView(i) >= 0 ? { kind: "node", i: toView(i) } : k >= 0 ? { kind: "visitor", k } : null, leadEnd);
    // an opinion given on an earlier version, its What changed closed (web/src/tips.ts, stale-opinion)
    if ($("#panel details[data-rv-changes]:not([open])")) page.offerTip("stale-opinion");
    if (i !== null && editedNow(i) === null && !pastShown())
      void edited(i).then((e) => {
        if ((e || reviewBox.needsSource(i)) && selected() === i && !pastShown()) {
          panel.show(i);
          sources.follow(i);
        }
      });
  };
  page.showSelected = showSelected;

  // the first view: the one the address names, else the tab the reader left on show, else the
  // Project
  const linked = decodeState(location.hash);
  /** a link to the help's film (`#tips`, `#tips=<chapter>`: web/src/state.ts), opened once the page
   *  is there; and the part of the address that says the film shows, while it does */
  const filmLink = tipsIn(location.hash);
  page.filmPart = "";
  let first = linked ? linked.view ?? PROJECT : S.active ?? PROJECT;
  /** why the view the address names could not be opened: said once the page is there, which shows
   *  the Project instead */
  let notOpened: string | null = null;
  if (linked?.scope) {
    const v = await views.open(linked.scope, { version: linked.version ?? null });
    if (typeof v !== "string") first = v.id;
    else notOpened = `This link's view could not be opened: ${v}`;
  }

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
    nodeClick: (j, shift) => void page.clickOn(pickDecl(vg().nodes[j].name), shift),
    // a visitor is a declaration as any: clicked with the tool (ViewSpec decision 27)
    visitorClick: (k, shift) => {
      if (page.visitors[k]) page.clickOn(pickDecl(page.visitors[k].name), shift);
    },
    clusterClick: (c, shift) => void page.clickOn(pickCluster(c), shift),
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
        const v = vg().nodes[i];
        const f = canvas.fileOf(i);
        // by status, the state in words beside its colour; by kind, the file's build trouble
        const ss = STATUSES[canvas.statusOf(i)];
        const st =
          canvas.scheme === "status"
            ? ` <span class="tip-st">${STATUS_LABEL[ss]}</span>`
            : f && STATE_LABEL[f.state]
              ? ` <span class="tip-st st-${f.state}">${STATE_LABEL[f.state]}</span>`
              : "";
        // an axiom's ringed, by either scheme (web/src/axiomring.ts)
        const dot = canvas.scheme === "status" ? `ss s-${ss}${vg().isExt(i) ? " k-external" : ""}${ringed(v.kind) ? " axiom" : ""}` : kindDot(v.kind, vg().isExt(i));
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
      sync.sharePins();
      linear.refresh();
      const i = selected();
      if (i !== null) panel.show(i);
    },
    foldChanged: () => {
      sync.shareFolds();
      outline.render();
      clusterPanel.refresh();
      page.showLevel();
    },
    menu: (t, x, y, world) => page.openMenu(t, x, y, world),
    frozenDrag: () => say(frozenWhy()),
  });
  page.canvas = canvas;

  /** a read-only reader's notes opened or collapsed, by id (CollabSpec decision 11, the owner's
   *  decision of 2026-10-16): theirs alone, over the state everyone shares, in this page and gone on
   *  reload, as their folds are */
  const ownOpen = new Map<string, boolean>(reader && kept ? kept.notes : []);
  page.ownOpen = ownOpen;
  /** Notes as this page shows them: each open or collapsed as its reader left it, where it is theirs
   *  alone (`ownOpen`), else by its own state. */
  const asOpenHere = <T extends { id: string; open: boolean }>(ns: T[]): T[] =>
    ownOpen.size ? ns.map((n) => (ownOpen.has(n.id) && ownOpen.get(n.id) !== n.open ? { ...n, open: ownOpen.get(n.id)! } : n)) : ns;

  // the notes on the board on show (web/src/sticky.ts): the project's that the board holds and the
  // view's own, placed again every frame the canvas draws; what is done to one goes to everyone, as
  // the view's operations or the project's notes' (AttachmentSpec decisions 13–19)
  const stickies: Stickies = new Stickies($("#stickies"), canvas, {
    notes: () => ({ project: asOpenHere(projectNotes.list), view: asOpenHere(nav.board?.rec.notes ?? []) }),
    // the Project holds every note of the project; another board what its scope gives and its
    // view's lists (the owner's decision of 2026-10-11), the links read as the board reads the review
    items: () => ({ all: !nav.board || fixedScope(nav.board.rec), items: nav.board?.rec.items, links: boardReview().links ?? [] }),
    board: () => (nav.board ? { nodes: vg().nodes, full: nav.board.full.nodes, mode: cm(), nowName: nav.board.past?.past.nowName } : null),
    // a note attached to a declaration shows at the reader's visitor of it, and falls back under the
    // other clustering to beside it in the Project's layout of that clustering
    visitors: () => page.visitors.map((v) => v.name),
    whole: (m) => ({ L: page.meta.layouts[m], index: page.present.byName }),
    resolve: (name) => (page.g.byName.has(name) ? name : null),
    go: (name) => {
      const i = page.g.byName.get(name);
      if (i !== undefined) page.go(i);
    },
    moves: (h) => !frozen() && dragMoves(page.locked, h),
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
    openCarry: (_id, c) => papers.openCarry(c),
  });
  page.stickies = stickies;
  canvas.onFrame = () => stickies.frame();
  // Fit to screen, and a board's first framing, hold the notes' icons too, and their cards where
  // they fit
  canvas.fitExtra = (k, cards) => stickies.fitBoxes(k, cards);

  // the linear form (ExportSpec decision 18, web/src/linear.ts): the board drawn as its document's
  // outline, while the Export window is open or at the reader's asking (⋯, o)
  const linearBtn = $("#linear-btn");
  const linear: LinearForm = new LinearForm($("#linear") as HTMLCanvasElement, canvas, {
    outline: () => {
      const b = nav.board;
      if (!b) return Promise.resolve("There is no board on show.");
      // the build the board shows, as its document is printed at it (ExportSpec decision 16)
      const version = b.preview ? (b.past?.past?.snapshot.id ?? null) : undefined;
      return data.exportOutline(b.id, version);
    },
    graph: () => vg(),
    noteSpot: (id) => stickies.spotOf(id),
    lit: (i) => !!canvas.active?.[i],
    edgeLit: (u, v, site) => canvas.edgeLit(u, v, site),
    keyLinks: () => canvas.keyLinks,
    selectDecl: (i, shift) => void page.clickOn(pickDecl(vg().nodes[i].name), shift),
    selectSection: (c, shift) => void page.clickOn(pickCluster(c), shift),
    frozen: () => (frozen() ? frozenWhy() : null),
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
    say: (text) => say(text),
    changed: (on) => {
      linearBtn.classList.toggle("on", on);
      linearBtn.setAttribute("aria-pressed", String(on));
      page.people.report();
    },
  });
  page.linear = linear;
  linearBtn.addEventListener("click", () => linear.toggle());

  /** In the artwork mode (ExportSpec decision 19, the owner's decision of 2026-10-15): of the bar,
   *  what is out of reach — all but Share and Search; and the keys that still act. */
  const ART_INERT = "#bar .brand, #bar .library-wrap, #export-btn, #activity-btn, #bar .talk-wrap, #bar .peers-wrap, #bar .who-wrap, #help-btn, #bar .more-wrap";
  const ART_KEYS = new Set(["/", "1", "2", "3", "f", "+", "=", "-", "_", "e", "[", "]", "l"]);
  page.ART_KEYS = ART_KEYS;
  // the board as a picture (ExportSpec decision 19, web/src/artframe.ts): the board itself, drawn
  // with the artwork's settings (`artLook`, drawLook below), a frame over it saying what is saved
  page.artLook = null;
  /** the project's git source and commit as git says them, asked when the page opens and again
   *  whenever the artwork comes (its foot; GET /api/git): a commit made after the build is told */
  let gitNow: GitSource | null = null;
  /** the last asking of it, which a link's recipe waits for before it saves (openRecipe) */
  let gitAsked: Promise<void> = data.git().then((git) => {
    gitNow ??= git;
  });
  const art = new ArtFrame($("#art"), $("#art-panel"), $("#art-sky") as HTMLCanvasElement, canvas, {
    title: () => views.title(nav.board.id),
    saved: () => S.artwork as Partial<ArtSettings> | undefined,
    save: (s) => {
      S.artwork = { ...s };
      store.save();
    },
    now: () => ({ scheme: canvas.scheme, theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light" }),
    look: (s) => {
      const coming = !page.artLook && !!s;
      page.artLook = s && { ...s };
      drawLook();
      if (coming)
        gitAsked = data.git().then((git) => {
          gitNow = git;
          art.refresh();
        });
    },
    changed: () => page.people.report(),
    notes: () => stickies.asDrawn(),
    // the commit checked out now; on a past build's board, that build's, with the project's source
    source: () => {
      const then = vg().meta.project.git;
      const git = pastShown() ? then && { ...then, source: then.source ?? gitNow?.source ?? null } : gitNow;
      return git ? sourceLine(git) : null;
    },
    // the targets a picture can mark: every one of the review's, by the name the board writes
    targets: () =>
      Object.keys(page.review.data.targets)
        .map((name) => ({ name, label: name.split(".").pop() ?? name }))
        .sort((a, b) => a.label.localeCompare(b.label) || a.name.localeCompare(b.name)),
    // the title where the reader gave none: the project's name, its declarations and its targets
    titles: () => titleOf(page.meta.project.name, page.meta.projectCount, Object.keys(page.review.data.targets).length),
    say: (text) => say(text),
  });
  page.art = art;
  // the board's names are written in an artwork's fonts once they are there
  document.fonts?.addEventListener?.("loadingdone", () => {
    if (!page.artLook) return;
    canvas.invalidate();
    canvas.request();
  });
  /** The board drawn with the artwork's settings while its mode is on, or as the reader's own again
   *  (ExportSpec decision 19): the colouring and the theme, the background, the notes, the edges, the
   *  names, the targets and the selection; the panels put away for the frame. The reader's own
   *  choices are kept as they are, under it. */
  const drawLook = () => {
    const a = page.artLook;
    document.body.classList.toggle("framing", !!a);
    document.body.classList.toggle("art-nonotes", !!a && !a.notes);
    if (a && a.background !== "theme") document.body.dataset.artBg = a.background;
    else delete document.body.dataset.artBg;
    // the cells and the starfield are dark, on a dark ground round the frame
    if (a && a.style !== "board") document.body.dataset.artStyle = a.style;
    else delete document.body.dataset.artStyle;
    artReach();
    if (a) linear.hide("reader", "followed");
    holdTheme(a ? (a.style === "board" ? a.theme : "dark") : null);
    canvas.setArt(a && { labels: a.labels, namesFrom: a.namesFrom, hidden: new Set(a.hiddenNames), shown: new Set(a.shownNames), ruled: new Set(a.ruledNames), edges: a.edges, targets: a.targets, shownTargets: new Set(a.shownTargets), keys: a.keys, style: a.style });
    page.applyScheme();
    page.syncEdges();
    page.apply();
  };
  /** Of the bar in the artwork mode, Share and Search alone (the owner's decision of 2026-10-15): the
   *  rest is out of reach until the mode is left, by the pointer and by the keyboard — but the people
   *  while the reader follows someone, whose initials clicked again end following (CollabSpec,
   *  "Following ends" and "What following leaves"): the mode is the follower's own once it has. */
  const artReach = () => {
    for (const el of document.querySelectorAll<HTMLElement>(ART_INERT)) el.inert = !!page.artLook && !(page.people.following && el.matches(".peers-wrap"));
  };
  page.artReach = artReach;
  /** when the board was last drawn: a link's recipe saves its files once the board is still */
  let drawnAt = 0;
  canvas.onFrame = () => {
    drawnAt = performance.now();
    stickies.frame();
    // the artwork's list of names follows what its frame holds
    art.frame();
  };
  // the notes the outline holds are those the board shows
  stickies.onRender = () => linear.refresh();
  /** the board the notes were last drawn for */
  let stickiesOn = "";

  // the sections a reader folds away: the targets, and the board's filter (folded until the reader
  // opens it)
  const shut = (section: string) => store.isShut(section);
  page.shut = shut;
  const toggleSection = (section: string) => {
    store.toggleShut(section);
    if (section === "targets") page.targetList.render();
    else boardPanel.render();
  };
  page.toggleSection = toggleSection;

  // what is trusted without review, in a popover from the side panel (web/src/trust.ts)
  const trust = new Trust($("#trust-list"), $("#trust-pop"), {
    review: () => ({ data: page.review.data, blocked: blocked(), readOnly: !!data.snapshot || pastShown() || !!reader, ...(pastShown() ? { note: PAST_REVIEW } : reader ? { note: READ_ONLY_REVIEW } : {}) }),
    graph: () => page.g,
    // each target counts what its review holds under the trust asked about (shared/reviewqueue.ts)
    targets: () =>
      Object.keys(page.review.data.targets)
        .map((name) => ({ name, i: page.g.byName.get(name) }))
        .filter((t): t is { name: string; i: number } => t.i !== undefined)
        .map((t) => ({ name: t.name, count: (d) => reviewCount(page.g, d, t.i) })),
    ensureReviewer: () => page.people.ensure(),
    submit,
    show: (p) => page.goToPrefix(p),
  });
  page.trust = trust;

  // The side panel holds the targets and the cluster tree; over the tree, two buttons open the rest
  // beside it (decided 2026-10-08, the page made simpler): the board's settings (⚙ Board: its scope,
  // clustering, depth, Re-layout) and what is trusted (Trusted, with how many prefixes).
  const boardPop = new Popover($("#board-btn"), $("#board-pop"), {
    place: () => besideSide($("#board-btn"), $("#board-pop")),
    changed: (open) => (open ? boardPanel.render() : boardPanel.reset()),
  });
  page.boardPop = boardPop;
  const trustPop = new Popover($("#trusted-btn"), $("#trust-list"), {
    place: () => besideSide($("#trusted-btn"), $("#trust-list")),
    // the question it asks, and the name that question may ask for, are part of it
    keep: "#trust-pop, #modal",
    changed: (open) => open && trust.render(),
  });
  page.trustPop = trustPop;
  /** The Trusted button: a shield, and how many prefixes are trusted. */
  const renderTrusted = () => {
    const n = page.review.data.trusted.length;
    $("#trusted-btn").innerHTML = `<span class="tl-shield">${SHIELD}</span>Trusted <span class="side-n">${n}</span>`;
    if (trustPop.open) trust.render();
  };

  const files = () => new Map((page.build?.files ?? []).map((f) => [f.module, f]));
  page.files = files;
  const outline = new Outline($("#outline"), {
    // a row is its cluster: clicked with the tool, and gone to
    select: (c, shift) => {
      if (page.clickOn(pickCluster(c), shift) && shownCluster() === c) canvas.flyToCluster(c);
    },
    picked: (c) => page.picks.some((p) => !!p.root && clusterOn(p.root, canvas.layout, cm()) === c),
    toggleFold: (c) => canvas.toggleFold(c),
    isFolded: (c) => canvas.folded.has(c),
    isCollapsed: (c) => canvas.isCollapsed(c),
    stateOf: (c) => {
      if (pastShown()) return "";
      const f = page.fileIndex.get(canvas.layout.clusters[c].key);
      return f && STATE_LABEL[f.state] ? `st-${f.state}` : "";
    },
    trustCell: (c) => trust.cell(canvas.layout.clusters[c], cm()),
    trustClicked: (c, row) => trust.clicked(canvas.layout.clusters[c], cm(), row),
    hide: (c) => hideLevel(canvas.layout.clusters[c].key),
  });
  page.outline = outline;
  page.fileIndex = files();

  // the board's settings, in the ⚙ Board popover: its scope as chips (web/src/boardpanel.ts)
  const boardPanel: BoardPanel = new BoardPanel($("#board"), $("#board-note"), {
    view: () => {
      const b = nav.board;
      if (!b) return null;
      let own = 0;
      for (let i = 0; i < page.g.projectCount; i++) own += b.bs.set[i];
      return { rec: b.rec, title: views.title(b.id), own, outside: b.bs.count - own };
    },
    setScope: (q): Promise<string | null> => sync.setScope(q),
    snapshot: () => !!data.snapshot,
    shut,
    toggle: toggleSection,
  });
  page.boardPanel = boardPanel;

  // the board on show, shared: this page's changes out, the others' in (web/src/boardsync.ts)
  const sync: BoardSync = new BoardSync(views, nav, {
    canvas,
    outline,
    boardPanel,
    notes,
    snapshot: !!data.snapshot,
    stream: () => page.people.stream,
    me: () => page.people.name,
    colorOf: (name) => page.people.colorOf({ name }),
    lost: () => page.people.lost(),
    tabsChanged: () => page.renderTabs(),
    notesChanged: () => stickies.render(),
    boardChanged: () => linear.refresh(),
    levelChanged: () => page.showLevel(),
    activityChanged: () => page.activity.changed(),
    hint: (text) => say(text),
    writeAddress: (push) => page.writeAddress(push),
    // a preview of the view at another build is arranged by nobody here (web/src/views.ts); a view
    // kept at a past build is arranged as any (the owner's decision of 2026-10-10)
    frozen: () => (frozen() ? frozenWhy() : null),
    // the view's own focus, or its link, changed: the review follows where the focus in force did
    focusChanged: () => {
      const was = page.focusWas;
      syncFocus();
      if (page.focusWas !== was) page.apply();
    },
    // a target linked elsewhere, or its view deleted: its panel says so
    linksChanged: () => showSelected(),
  });
  page.sync = sync;

  /** Hide a level of the board on show by its cluster's key, for everyone on it (ViewSpec decision
   *  24): the outline's rows, a cluster's panel and the canvas's menu call it. */
  const hideLevel = (key: string) => void sync.hideLevel(key);
  page.hideLevel = hideLevel;
  /** The levels the board on show hides, in ⚙ Board: how many, Show all, and each with Show. */
  const renderHidden = () => {
    const keys = nav.board?.rec.hidden[cm()] ?? [];
    const list = $("#hidden-list");
    $("#hidden-levels").innerHTML = keys.length
      ? `Hidden levels: ${keys.length} — <button class="link" data-show-all title="Show every hidden level again, for everyone on this board">show all</button>`
      : `<span class="muted" title="Hide a level from its row in the side panel, or from its panel: what it holds moves up into its parent">None hidden</span>`;
    list.hidden = !keys.length;
    list.innerHTML = keys
      .map((k) => {
        const name = k.replace("⟨external⟩", "External");
        return `<div class="hl-row"><span class="hl-key" title="${escapeHtml(name)}">${escapeHtml(name)}</span><button class="link" data-show="${escapeHtml(k)}" title="Show this level again, for everyone on this board">show</button></div>`;
      })
      .join("");
  };
  $("#board-pop").addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const one = t.closest<HTMLElement>("[data-show]")?.dataset.show;
    if (one !== undefined) return void sync.setHidden([one], false);
    if (t.closest("[data-show-all]")) void sync.setHidden([...nav.board.rec.hidden[cm()]], false);
  });

  // the conversation window, the reader's own (web/src/chatwin.ts, CollabSpec decision 13): opened
  // and closed by the reader alone; it starts at the canvas's bottom left, beside the side panel
  const chatWin = new ChatWindow($("#convo"), store, {
    // under the bars, not under the review strip, which comes and goes with the view
    insets: () => ({ left: canvas.insets.left, top: $("#viewbar").getBoundingClientRect().bottom + 8 }),
    expanded: () => page.talk.expanded(),
    toggled: (open) => {
      $("#talk-btn").setAttribute("aria-pressed", String(open));
      if (open) $("#talk-notice").hidden = true;
    },
  });
  page.chatWin = chatWin;
  // the following strip steps aside from it rather than cover its box
  keepStripClear($("#following"), $("#convo"));
  // a phone: the bar's ⋯, the side panel's drawer, the panel's sheet (web/src/phone.ts)
  new Phone({
    closePanel: () => $<HTMLElement>("#panel [data-close]")?.click(),
    resized: () => syncInsets(),
    modeHint: (m) => TAP_HINT[m as Tool] ?? "",
  });
  // an upright monitor: the board above a work area (web/src/monitor.ts)
  new MonitorLayout({ resized: () => syncInsets() });
  const syncInsets = () => {
    const side = $("#side").getBoundingClientRect();
    // the panel, or the timeline's drawer in its place; the selection bar heads that column, which
    // it moves down by its height
    const open = $("#panel").classList.contains("open") || $("#activity").classList.contains("open") || $("#lostfound").classList.contains("open");
    // the review strip, and under it the note of a view kept at a past build: a kept view focused
    // on a target has both (HistorySpec decision 19)
    const height = (id: string) => ($(id).hidden ? 0 : $(id).offsetHeight + 6);
    const lens = height("#lensbar"), kept = height("#tm-kept");
    const strip = lens + kept > 0;
    // the note's height too, where it is the second
    const second = lens && kept;
    const bar = $("#selbar");
    document.body.style.setProperty("--selbar-h", bar.hidden ? "0px" : `${bar.offsetHeight + 8}px`);
    document.body.style.setProperty("--lens-h", `${lens}px`);
    // on a phone the selection bar goes under them both
    document.body.style.setProperty("--strip-h", `${lens + kept}px`);
    // a phone (web/src/phone.ts): the side panel is a drawer, the panel a sheet from the bottom,
    // the selection bar across the top, the legend and the zoom's box at the bottom
    const sheet = $("#panel").classList.contains("open") ? $("#panel").offsetHeight : 0;
    canvas.insets = isPhone()
      ? {
          left: 0,
          right: 0,
          top: bar.hidden ? $("#viewbar").getBoundingClientRect().bottom + (strip ? 44 + second : 12) : bar.getBoundingClientRect().bottom + 12,
          bottom: sheet ? sheet + 8 : 56,
        }
      : isTall()
        ? // a tall screen (PhoneSpec, "Tall screens"): the whole width, above the sheet and the dock
          tallInsets()
        : monitorInsets() ?? {
          left: side.width ? side.right + 8 : 0,
          // offsetWidth, not the bounding box: the panel may still be sliding in
          right: open ? $("#panel").offsetWidth + 20 : bar.hidden ? 0 : bar.offsetWidth + 20,
          top: $("#viewbar").getBoundingClientRect().bottom + (strip ? 52 + second : 28),
          bottom: 48,
        };
    // the zoom buttons keep to the canvas's bottom right, the review strip to its middle; where the
    // panel leaves no canvas (a narrow window), there is nothing to zoom
    document.body.style.setProperty("--inset-right", `${canvas.insets.right}px`);
    document.body.style.setProperty("--inset-left", `${canvas.insets.left}px`);
    $("#zoom").hidden = innerWidth - canvas.insets.right - canvas.insets.left < 140;
    // the conversation window, where it has not been put by the reader, starts beside the side
    // panel (it does not move while the reader moves it, nor when a source window opens)
    chatWin.layout();
  };
  page.syncInsets = syncInsets;

  /** The review strip, wherever the review has a focus (ReviewSpec, "Reviewing a target"; ViewSpec
   *  decision 28): it stays while the reader goes from one declaration to the next. */
  const renderStrip = () => {
    const r = reviewRoot();
    const bar = $("#lensbar");
    bar.hidden = r === null;
    if (r !== null) flow.renderStrip(r);
  };
  page.renderStrip = renderStrip;
  /** The focus may have changed (the reader's choice, the view's, the targets, the board's set): what
   *  depends on it follows, and the header says it. */
  const syncFocus = () => {
    const f = reviewName();
    if (f !== page.focusWas) {
      page.focusWas = f;
      page.syncStatus();
      page.applyScheme();
    }
    page.focusMenu.render();
  };
  page.syncFocus = syncFocus;
  Object.assign(page, schemePart(page));
  Object.assign(page, followPart(page));
  Object.assign(page, talkPart(page));
  Object.assign(page, peoplePart(page));
  /** Open a link's artwork recipe (ExportSpec decision 20, shared/artrecipe.ts) on the board its
   *  address opened, the selection it carries made: resolved against this board, the artwork mode
   *  opened with what it says (not kept as this reader's settings until they change one), the whole
   *  board fitted in its frame; the files it asks for saved once the board has been still a moment,
   *  with its fonts and the git commit there. What it names that this board has not is said in a
   *  line; `data-artwork-saved` on the page says what was saved, for a script that waits for it. */
  const openRecipe = async (link: { text: string; save: ("png" | "svg")[] }) => {
    const read = readRecipe(decodeRecipe(link.text));
    if ("error" in read) return say(`This link's artwork could not be read: ${read.error}`);
    const L = canvas.layout;
    const { look, problems, left } = resolveRecipe(read.recipe, {
      clusters: L.clusters,
      clusterOf: (name) => {
        const i = page.g.byName.get(name);
        const j = i === undefined ? -1 : toView(i);
        return j < 0 ? undefined : L.cluster[j];
      },
      targets: Object.keys(page.review.data.targets),
      projectCount: page.g.projectCount,
    });
    if (problems.length || left) say(`This link's artwork: ${[...problems, ...(left ? [`${left} names left out, more than an artwork carries`] : [])].join("; ")}.`);
    if (art.isOpen) await art.close();
    // come: the board drawn with the look, which asked for the git commit as it came (gitAsked)
    await art.open(look);
    if (!link.save.length) return;
    const since = performance.now();
    await gitAsked;
    await document.fonts?.ready;
    // drawn since the mode came, then still for 800 ms (the overview's edges come from a worker), at
    // most 20 s
    canvas.request();
    await untilStill({ now: () => performance.now(), drawnAt: () => drawnAt, sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)) }, since);
    // a browser asks before a site saves several files at once (the owner's decision of 2026-10-15:
    // the reader is told)
    if (link.save.length > 1) say(`Saving the picture as ${link.save.map((k) => k.toUpperCase()).join(" and ")}: your browser may ask to allow this site to download several files.`);
    const made = await art.save(link.save);
    document.documentElement.dataset.artworkSaved = made.length ? made.join(",") : "none";
  };
  page.openRecipe = openRecipe;
  Object.assign(page, tabsPart(page));
  Object.assign(page, sharePart(page));
  Object.assign(page, timelinePart(page));

  // ---------------------------------------------------------------- into the Time Machine

  /** Open the Time Machine at a build (`snapshot`; the latest where left out), on a declaration
   *  (`name`): the build-status popover's Time Machine and recent builds, and the lost-and-found's
   *  Show in history, all come here. */
  const timeMachine = (at?: TimeMachineAt): void => void openTimeMachine(at);
  page.timeMachine = timeMachine;
  Object.assign(page, selectionPart(page));

  /** The review changed, once per change whoever made it (this reader, someone else, the logs on disk):
   *  everything that shows it follows. A board whose scope reads the review (trusted, statuses,
   *  advice) may hold another set now: the board on show is drawn again at once. */
  const reviewChanged = () => {
    const followed = page.followSelection();
    page.targetTcbs.clear();
    views.reviewChanged();
    if (views.board(nav.board.id) !== nav.board) void nav.redraw().then(() => boardPanel.render());
    page.syncStatus();
    trust.reviewChanged();
    renderTrusted();
    // what is lit reads the review when a pick does (key declarations, trust, statuses), and the
    // key graph's edges under Keys always: lit again; else what shows the review is drawn again
    const q = selectionQuery(page.picks);
    if (followed || S.mode === "keys" || (q && readsReview(q))) page.apply();
    else {
      outline.render();
      // a visitor's colour by status, and its diamond, are the review's too
      page.drawVisitors();
      renderStrip();
      showSelected();
      page.renderSelBar();
    }
    page.activity.changed();
    boardPanel.render();
    page.renderTabs();
    papers.refresh();
    // what notes carry is drawn from the library's records, which are the review's
    stickies.render();
    if (followed) page.selectionFollowed();
  };
  /** The whole review (where this page holds another revision than the server's, or events came in
   *  between): taken unless this page holds that revision already. */
  const takeWhole = (st: ReviewState) => {
    if (st.epoch === page.review.epoch && st.rev <= page.review.rev) return;
    page.review = st;
    reviewChanged();
  };
  /** The whole review read again (GET /api/review, which a page holding it is answered 304): where
   *  the event stream says the server holds another revision, and where a change cannot be applied;
   *  one reading out at a time (web/src/reviewread.ts). */
  const wholeReview = new WholeReview(data.review, takeWhole, () => page.review);
  page.wholeReview = wholeReview;
  /** A change of the review (shared/review.ts, ReviewChange): its events applied to the review this
   *  page holds when it is the one they follow; once only, whether it came as the answer to this
   *  page's request or as the event every page gets. Anything else — a change missed, another run
   *  of the server — has the whole review read again. An event of a kind no longer recorded is
   *  skipped, as the server's replay skips it (the server sends none). */
  const takeChange = (c: ReviewChange) => {
    if (c.epoch === page.review.epoch && c.rev <= page.review.rev) return;
    // each event read as its log was: an agent's marked as one, an invited person's with their id
    const read = (e: unknown) => {
      const o = e as { agent?: unknown; person?: unknown };
      return readEvent(e, o.agent === true, validPersonId(o.person) ? o.person : null);
    };
    const events = c.epoch === page.review.epoch && c.base === page.review.rev && c.events ? c.events.map(read).filter((e) => e !== null) : null;
    if (!events || events.some((e) => typeof e === "string")) {
      void wholeReview.fetch();
      return;
    }
    // a replay that changed nothing (a new graph's reading, server/review.ts): the revision moves on
    const same = !events.length && JSON.stringify(c.problems) === JSON.stringify(page.review.problems);
    for (const e of events as ReviewEvent[]) applyEvent(page.review.data, e);
    page.review = { ...page.review, rev: c.rev, problems: c.problems, error: problemsText(c.problems) };
    if (!same) reviewChanged();
  };
  page.takeChange = takeChange;

  /** Something said for a moment where the hint is (below the review strip and the note of a kept
   *  view, where they show): the hint shows nothing otherwise. */
  const say = (text: string) => {
    const hint = $("#hint");
    if (saying) clearTimeout(saying);
    // shown before it is written: a live region in the page when its words change is read out
    hint.hidden = false;
    hint.textContent = text;
    hint.classList.add("say");
    hint.classList.toggle("below", !$("#lensbar").hidden || !$("#tm-kept").hidden);
    saying = setTimeout(() => {
      saying = null;
      hint.hidden = true;
      hint.classList.remove("say", "below");
    }, 3500);
  };
  page.say = say;
  /** The tips in place what is recorded may be the moment of: a target's second declaration
   *  approved on a view focused on it, while it has no key declaration; a key marked ends that. */
  let approvedInFocus = 0;
  const tipsOnReview = (op: ReviewRequest) => {
    if (op.op === "key" && op.on) return page.didTip("key-in-target");
    if (op.op !== "opinion" || op.verdict !== "approve") return;
    const r = reviewRoot();
    const i = page.g.byName.get(op.name);
    if (r === null || i === undefined || !flow.inReview(r, i) || keyMarks(page.review.data, page.g.nodes[r].name).length) return;
    if (++approvedInFocus >= 2) page.offerTip("key-in-target");
  };

  /** The board on show is of another graph (a past build's, or the graph on show again): what
   *  speaks of the whole graph — the panel, the review, the search, the source windows — speaks of
   *  it. A pinned window shows its declaration there, found by name: on a past board, as that build
   *  had it (HistorySpec decision 23). */
  const useGraph = (G: Graph) => {
    page.g = G;
    panel.g = page.g;
    reviewBox.g = page.g;
    page.searchBox.setGraph(page.g);
    if (sources.all.some((w) => w.g !== G)) {
      for (const w of sources.all) w.g = G;
      sources.redraw((name) => G.byName.get(name));
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
    syncInsets();
  };

  /** Views are not switched in the Time Machine (HistorySpec decision 16): true, and the reader is
   *  told so, while it is open. */
  const noSwitch = (): boolean => {
    if (!tm.active) return false;
    say("Views are not switched in the Time Machine: leave it first (Esc).");
    return true;
  };
  page.noSwitch = noSwitch;

  /** Open the Time Machine on the view on show (the hook the build-status popover and the
   *  lost-and-found call): at `snapshot`, the latest by default; on `name` there — a visitor of that
   *  build where this view does not hold it (ViewSpec decision 27). */
  const openTimeMachine = async (at: TimeMachineAt = {}): Promise<boolean> => {
    if (data.snapshot) {
      say("A snapshot has no history: the Time Machine is the server's.");
      return false;
    }
    if (!(await tm.open({ snapshot: at.snapshot }))) return false;
    page.offerTip("first-time-machine");
    if (!at.name || page.goName(at.name)) return true;
    say(`${at.name} is not in the graph of that build.`);
    return true;
  };
  page.openTimeMachine = openTimeMachine;

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
    sync.afterPost();
    if (!ok) return `“${name}” is made, kept at that build: it is in Views.`;
    // the tabs were hidden while it was shown: drawn again now, its tab brought into sight
    page.renderTabs();
    page.commit();
    return null;
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
      canvas.setVisitors([], [], []);
    }
    if (b.full !== page.g) useGraph(b.full);
    canvas.setGraph(b.graph);
    const marks = b.past ? boardMarks(b.past.past, b.graph.n, b.toFull) : null;
    canvas.setPast(marks?.marks ?? null, marks?.now);
    canvas.setLayout(L, b.rec.pins[m], b.rec.folds[m], m);
    canvas.setFrozen(frozen());
    linear.refresh();
    page.exportModal.boardChanged();
    // a note being written stays while its board is drawn again (the review changed what it
    // holds); another board closes it
    if (b.id !== stickiesOn) stickies.reset();
    stickiesOn = b.id;
    stickies.render();
    outline.setLayout(L, `${b.id}\u0000${m}`);
    canvas.setBuild(b.past ? null : page.build?.files ?? null);
    // the whole project's layout holds the outside world; a scope without it hides it
    canvas.setShowExternals(b.bs.whole ? b.bs.outside : true);
    for (const btn of document.querySelectorAll<HTMLElement>("#board-pop [data-cluster]")) btn.classList.toggle("on", btn.dataset.cluster === m);
    $("#side-what").textContent = m === "module" ? "Files" : "Namespaces";
    notes.clear();
    page.syncStatus();
    page.applyScheme();
    page.showLevel();
    page.syncPeers();
    boardPanel.render();
    renderHidden();
    page.apply();
    syncPast();
  };
  Object.assign(page, addressPart(page));
  // the review strip: its target's name goes back to the target
  $("#lens-title").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-go]");
    if (b) walk(Number(b.dataset.go));
  });
  Object.assign(page, livePart(page));
  Object.assign(page, toolbarPart(page));
  Object.assign(page, menuPart(page));
  Object.assign(page, notesPart(page));
  Object.assign(page, keysPart(page));

  // a handle for diagnosis from the console: window.visualproof.canvas
  // and the Time Machine's hook, as the build-status popover and the lost-and-found call it
  (window as unknown as { visualproof: object }).visualproof = { canvas, linear, graph: () => page.g, present: () => page.present, board: () => nav.board, views, tm, timeMachine: (at?: TimeMachineAt) => openTimeMachine(at) };
  window.addEventListener("resize", syncInsets);
  // the first view, and the place the link names on it (or where the reader was); a tab of a view
  // the server forgot opens again from its query
  // the reader's own focus there, which the address does not carry, as they left it (ViewSpec
  // decision 28)
  const firstPlace: Place | null = linked ? { mode: linked.mode, picks: linked.picks, shown: linked.shown, cam: null, ...keptFocus(S.seen[first]) } : null;
  if (!(await nav.select(first, firstPlace))) {
    await nav.show(PROJECT, firstPlace);
    if (linked?.view && linked.view === first && !views.summary(first)) notOpened = VIEW_GONE;
  }
  page.listen();
  if (notOpened) say(notOpened);
  // a link with a snapshot of what its sharer saw: applied once, on the board its address opened
  const snap = snapshotIn(location.hash);
  if (snap) await page.openSnapshot(snap);
  // a link to a note (Copy link, CollabSpec decision 13): the note shown, on the board it opened
  const noteLink = noteIn(location.hash);
  if (noteLink) page.showNote(noteLink.ofView ? nav.board.id : "", noteLink.id);
  // the reader came to a place (a declaration, a view, what a sharer saw, an artwork): the welcome
  // stays quiet (GuideSpec decision 1)
  const deepLink = filmLink !== undefined || !!snap || !!noteLink || !!recipeIn(location.hash) || (!!linked && (!!linked.picks || !!linked.shown || (linked.view !== null && linked.view !== PROJECT) || !!linked.scope));
  // a link with an artwork's recipe (ExportSpec decision 20): once, after the board is there; the
  // files it asks for are saved meanwhile
  const recipe = recipeIn(location.hash);
  if (recipe) void openRecipe(recipe);
  // the builds the history holds: the clocks of views kept at one say which
  if (!data.snapshot) void tm.load().then(() => page.renderTabs());
  try {
    history.replaceState({ n: 0 }, "", "#" + encodeState(page.current()));
  } catch {
    // see writeAddress
  }
  page.renderNav();
  page.people.renderMe();
  reviewChanged();
  page.renderBuild();
  // the source windows the page had before it reloaded into its server's new version, on the
  // declarations found by name (web/src/reload.ts)
  if (kept && (kept.sources.following || kept.sources.pinned.length)) {
    const on = (w: { name: string; collapsed: boolean }) => {
      const decl = page.present.byName.get(w.name);
      return decl === undefined ? null : { decl, collapsed: w.collapsed };
    };
    const f = kept.sources.following && on(kept.sources.following);
    sources.mirror({ following: f, pinned: kept.sources.pinned.map(on).filter((w) => w !== null) });
    sources.release();
  }
  $("#loader").classList.add("gone");
  // faded out, it leaves the page: a screen reader would read "Reading the project…" at its end
  setTimeout(() => ($("#loader").hidden = true), 450);
  Object.assign(page, guidePart(page));
  void data.activity().then((events) => page.activity.load(events));
  // who this page is, then the others are told where it is; the camera and the source window
  // change without a step in the history, so they are looked at every second and a half
  void page.people.init().then(() => {
    page.people.start();
    // offered, never started by itself (GuideSpec decision 1); a link to the film opens it, at its
    // chapter: the visitor is watching already
    setTimeout(() => {
      page.guide.welcome(deepLink);
      if (filmLink !== undefined) page.guide.openHelp("tips", filmLink ? { chapter: filmLink } : {});
    }, 400);
    page.activity.changed();
    let last = "";
    setInterval(() => {
      const now = JSON.stringify(page.people.mode === "none" ? null : { s: sources.open, c: canvas.cam });
      if (now !== last) {
        last = now;
        page.people.report();
      }
    }, 1500);
  });
}

boot().catch((e) => console.error(e));
