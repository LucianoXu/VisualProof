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
import type { ChatMessage, PresenceView } from "../../shared/collab.ts";
import type { ClusterMode, GitSource, Layout } from "../../shared/graph.ts";
import { SITE_BODY, SITE_STMT } from "../../shared/graph.ts";
import { lightUp, zoomScope } from "../../shared/board.ts";
import type { Lit } from "../../shared/board.ts";
import { printQuery, readsReview } from "../../shared/query.ts";
import { keyMarked, keyMarks } from "../../shared/review.ts";
import type { Query } from "../../shared/query.ts";
import { applyEvent, covers, emptyReview, logFileName, problemsText, readEvent, validPersonId } from "../../shared/review.ts";
import type { ReviewChange, ReviewData, ReviewEvent, ReviewRequest, ReviewWhole } from "../../shared/review.ts";
import { reviewCount } from "../../shared/reviewqueue.ts";
import { noteExcerpt } from "../../shared/sticky.ts";
import { briefWhen } from "../../shared/titles.ts";
import { docTitle, fixedScope, focusFrom, linkRefused, PROJECT, titleOfScope, versionName, viewFocus } from "../../shared/views.ts";
import { BoardPanel } from "./boardpanel.ts";
import { BoardSync } from "./boardsync.ts";
import { GraphCanvas } from "./canvas.ts";
import { ClusterPanel } from "./clusterpanel.ts";
import { dataSource } from "./data.ts";
import { WholeReview } from "./reviewread.ts";
import type { DataSource, ReviewState, ViewAnswer } from "./data.ts";
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
import { People, READ_ONLY, personKey } from "./people.ts";
import { Asking, askMark } from "./askfollow.ts";
import type { AskFollow } from "../../shared/askfollow.ts";
import { PeerMenu } from "./peermenu.ts";
import { applyOwn, followedOf, presenceOf } from "./surfaces.ts";
import type { PageParts } from "./surfaces.ts";
import { Activity } from "./activity.ts";
import { LostAndFound } from "./lostfound.ts";
import { deployWaiting } from "./buildpop.ts";
import { githubBlob } from "../../shared/deploy.ts";
import { Editor } from "./editor.ts";
import { FocusMenu, keptFocus, readerFocus } from "./focus.ts";
import { kindDot, ringed } from "./axiomring.ts";
import { Legend } from "./legend.ts";
import { holdTheme } from "./theme.ts";
import { besideSide, Popover } from "./popover.ts";
import { ReviewBox } from "./reviewbox.ts";
import { ReviewFlow } from "./reviewqueue.ts";
import { SelectionBar } from "./selbar.ts";
import { clusterIndex, clusterOn, clusterPick, declPick, readSelection, remove, restsOn, selectionQuery, selectionText, shownOf, TOOLS } from "./selection.ts";
import type { KeysOf, Pick, Root, Tool } from "./selection.ts";
import { SourceWindow, sourceMemory } from "./sourcewin.ts";
import type { SourceHooks } from "./sourcewin.ts";
import { Sources } from "./sources.ts";
import { takeKept } from "./reload.ts";
import type { Kept } from "./reload.ts";
import { pairTop } from "./paperdock.ts";
import { Papers } from "./paperlinks.ts";
import { clusterSubject, fileOf, linkOf, PAST_LINK } from "../../shared/library.ts";
import { camOf, goneNames, missingLine, readSnapshot, snapshotIn, sortOut, writeSnapshot } from "../../shared/sharesnap.ts";
import { decodeRecipe, readRecipe, recipeIn, resolveRecipe } from "../../shared/artrecipe.ts";
import { STATUS_LABEL, STATUSES, statusCodes } from "./status.ts";
import type { Scheme } from "./status.ts";
import { Tabs } from "./tabs.ts";
import { Share } from "./share.ts";
import { excerpt, ownAgents, PUBLIC, stateWords, Talk } from "./talk.ts";
import { ChatWindow, keepStripClear } from "./chatwin.ts";
import { chipOf, copyLink, noteIn, siteLink, siteOrigins, withoutKeys } from "./chatlinks.ts";
import type { Chip } from "./chatlinks.ts";
import { planDoc } from "../../shared/doc/sections.ts";
import { ExportModal } from "./exportmodal.ts";
import { LinearForm } from "./linear.ts";
import { isPhone, isTall, Phone, tallInsets } from "./phone.ts";
import { MonitorLayout, monitorInsets } from "./monitor.ts";
import { ArtFrame } from "./artframe.ts";
import type { ArtSettings } from "./artwork.ts";
import { sourceLine, titleOf, untilStill } from "./artwork.ts";
import type { ExportHooks } from "./exportmodal.ts";
import { TargetList, targetStep } from "./targetlist.ts";
import { SHIELD, Trust } from "./trust.ts";
import { decodeState, encodeState, tipsIn } from "./state.ts";
import { Store } from "./store.ts";
import { typing } from "./typing.ts";
import { VERIFIED } from "./verified.ts";
import { ViewNav } from "./viewnav.ts";
import { readVisitors, shareVisitors } from "./visitors.ts";
import type { Place } from "./viewnav.ts";
import { Views } from "./views.ts";
import { LayoutQueue } from "./layoutqueue.ts";
import type { LayoutWorker } from "./layoutqueue.ts";
import type { Board } from "./views.ts";
import { buildWhen, TimeMachine } from "./timemachine.ts";
import type { TimeMachineAt } from "./timemachine.ts";
import { boardMarks, markWords, PAST_CHANGED, PAST_GHOST, PAST_RENAMED, reviewThen } from "./past.ts";
import type { PastGraph } from "./past.ts";
import { $, MODE_NAME, toolName, TAP_HINT, VIEW_GONE, STATE_LABEL, PAST_REVIEW, READ_ONLY_REVIEW, short } from "./page.ts";
import type { GraphInfo, Page } from "./page.ts";
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
  blocked: () => string | null;
  isTarget: (name: string) => boolean;
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
  selBar: SelectionBar;
  sources: Sources<SourceWindow>;
  shownCluster: () => number;
  showSelected: () => void;
  canvas: GraphCanvas;
  ownOpen: Map<string, boolean>;
  stickies: Stickies;
  linear: LinearForm;
  ART_KEYS: Set<string>;
  art: ArtFrame;
  trust: Trust;
  boardPop: Popover;
  trustPop: Popover;
  files: () => Map<string, FileStatus>;
  outline: Outline;
  sync: BoardSync;
  hideLevel: (key: string) => void;
  syncInsets: () => void;
  renderStrip: () => void;
  syncFocus: () => void;
  syncStatus: () => void;
  ownScheme: () => Scheme;
  chooseScheme: (s: Scheme) => void;
  legend: Legend;
  parts: PageParts;
  talk: Talk;
  chipFor: (url: string) => Chip | null;
  people: People;
  asking: Asking;
  openSnapshot: (text: string) => Promise<void>;
  openRecipe: (link: { text: string; save: ("png" | "svg")[] }) => Promise<void>;
  made: (r: ViewAnswer) => Promise<string | null>;
  named: () => Promise<string | null>;
  tabs: Tabs;
  focusMenu: FocusMenu;
  targetTcbs: Map<string, { names: Set<string>; modules: Set<string> } | null>;
  exportModal: ExportModal;
  showNote: (view: string, id: string) => void;
  activity: Activity;
  lostDrawer: LostAndFound;
  timeMachine: (at?: TimeMachineAt) => void;
  wholeReview: WholeReview<ReviewWhole>;
  takeChange: (c: ReviewChange) => void;
  say: (text: string) => void;
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
  const syncBusy = () => tabs.busy(nav.aimed !== null && [...awaited.values()].includes(nav.aimed));
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
  const projectNotes = new ProjectNotes(data.views, () => people?.stream ?? null);
  page.projectNotes = projectNotes;
  await projectNotes.load();
  const nav = new ViewNav(views, store, {
    show: (b, L) => showBoard(b, L),
    place: (p, fresh) => page.place(p, fresh),
    here: () => page.here(),
    // the address is written by the step that showed the view (one entry), or replaced after
    changed: () => {
      syncBusy();
      renderTabs();
      people.report();
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
      people.report();
      syncPast();
    },
    go: (name) => page.goName(name),
    say: (text) => say(text),
    keep: async (snapshot) => {
      if (reader) return READ_ONLY;
      if (!(await people.ensureLayout())) return "Keeping a build in a view is recorded under your name: give one first.";
      const why = await sync.keepVersion(snapshot);
      renderTabs();
      return why;
    },
    saveAs: (snapshot) => saveVersion(snapshot),
    frozen: () => (reader ? READ_ONLY : null),
    following: () => people.following,
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
    if (leaving && r === true) renderTabs();
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
        if (e.who) people.lost();
        return e.message;
      },
    );
  page.submit = submit;

  // the review flow where the review has a focus (ViewSpec decision 28): the focus's review set in
  // review order, the next one to review, why a declaration is in it (web/src/reviewqueue.ts)
  const flow = new ReviewFlow({ graph: () => page.g, review: () => boardReview(), reader: () => people.name });
  page.flow = flow;
  /** The same on the graph on show, whatever build the board shows: how far each target's review has
   *  come is the review's now (the targets list, the views menu) */
  const flowNow = new ReviewFlow({ graph: () => page.present, review: () => page.review.data, reader: () => people.name });
  /** Why this reader's opinions are refused until their log is fixed by hand (a line of it cannot
   *  be read, server/review.ts), or null. */
  const blocked = (): string | null => {
    const me = people.name?.trim();
    if (!me) return null;
    // someone invited by a personal link writes to their link's log (CollabSpec decision 9)
    const mine = logFileName(me, false, people.person?.id ?? null);
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
  /** The targets linked to the view on show (ViewSpec decision 29), in the order they were linked. */
  const linkedTargets = (): string[] => (nav.board?.rec.targets ?? []).filter(isTarget);
  /** The view's own focus, everyone's (shared/views.ts, viewFocus). */
  const viewFocusName = (): string | null => (nav.board ? viewFocus(nav.board.rec, isTarget, heldTargets) : null);
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
      reviewer: people.name,
      // someone invited by a personal link is their link (CollabSpec decision 9): their opinions
      // are told by it, as Withdraw finds them
      person: people.person?.id ?? null,
    }),
    ensureReviewer: () => people.ensure(),
    submit,
    said: (text) => say(text),
    queue: (i) => flow.queue(i),
    progress: (i) => flow.progress(i),
    reviewLens: (i) => reviewTarget(i),
    // the view the target is linked to (ViewSpec decision 29), or none, and linking it to the view
    // on show
    targetView: (i) => {
      const name = declNow(i);
      if (!isTarget(name)) return null;
      const id = views.linkedTo(name);
      return { title: id === undefined ? null : views.title(id), here: id === nav.board.id, why: linkWhy(name) };
    },
    linkHere: (i) => void linkTo(declNow(i)).then((why) => why && say(why)),
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
    void people.ensure().then((me) => {
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
    ensureName: async () => (await people.ensure()) !== null,
    following: () => people.followedName,
    changed: () => people.report(),
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
      const on = people.on(page.g.nodes[i].name);
      if (!on.length) return "";
      return (
        `<span>Also here:</span>` +
        on.map((p) => `<span class="avatar${p.agent ? " agent" : ""}" style="background:${people.colorOf(p)}" title="${escapeHtml(people.nameOf(p))}">${escapeHtml(people.label(p))}</span>`).join("") +
        `<span>${escapeHtml(on.map((p) => people.nameOf(p)).join(", "))}</span>`
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
      people.report();
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
      people.report();
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
    beside: () => (exportModal.isOpen ? ($("#export-modal .ex-box")?.getBoundingClientRect().width ?? 0) + 24 : 0),
    say: (text) => say(text),
    changed: (on) => {
      linearBtn.classList.toggle("on", on);
      linearBtn.setAttribute("aria-pressed", String(on));
      people.report();
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
    changed: () => people.report(),
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
    applyScheme();
    page.syncEdges();
    page.apply();
  };
  /** Of the bar in the artwork mode, Share and Search alone (the owner's decision of 2026-10-15): the
   *  rest is out of reach until the mode is left, by the pointer and by the keyboard — but the people
   *  while the reader follows someone, whose initials clicked again end following (CollabSpec,
   *  "Following ends" and "What following leaves"): the mode is the follower's own once it has. */
  const artReach = () => {
    for (const el of document.querySelectorAll<HTMLElement>(ART_INERT)) el.inert = !!page.artLook && !(people.following && el.matches(".peers-wrap"));
  };
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
  const toggleSection = (section: string) => {
    store.toggleShut(section);
    if (section === "targets") targetList.render();
    else boardPanel.render();
  };

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
    ensureReviewer: () => people.ensure(),
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

  // the board on show, shared: this page's changes out, the others' in (web/src/boardsync.ts)
  const sync: BoardSync = new BoardSync(views, nav, {
    canvas,
    outline,
    boardPanel,
    notes,
    snapshot: !!data.snapshot,
    stream: () => people.stream,
    me: () => people.name,
    colorOf: (name) => people.colorOf({ name }),
    lost: () => people.lost(),
    tabsChanged: () => renderTabs(),
    notesChanged: () => stickies.render(),
    boardChanged: () => linear.refresh(),
    levelChanged: () => page.showLevel(),
    activityChanged: () => activity.changed(),
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
    expanded: () => talk.expanded(),
    toggled: (open) => {
      $("#talk-btn").setAttribute("aria-pressed", String(open));
      if (open) $("#talk-notice").hidden = true;
    },
  });
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
      syncStatus();
      applyScheme();
    }
    focusMenu.render();
  };
  page.syncFocus = syncFocus;

  /** The review and the build on the canvas: the targets' stars, and where each declaration of
   *  the board stands (web/src/status.ts) — its colour in the Status scheme, the clusters' progress
   *  and the legend's counts. What agents advise is not among it: it stays in the panel. */
  const syncStatus = () => {
    const G = vg();
    // a past build's status is its review against now's opinions; its files' builds are not known
    canvas.setStatus(statusCodes(boardReview(), G, pastShown() ? new Map() : page.fileIndex));
    canvas.setTargets(Object.keys(page.review.data.targets).map((n) => G.byName.get(n)).filter((j): j is number => j !== undefined));
    // key declarations carry a diamond: where the review has a focus its target's, elsewhere every
    // target's (ExportSpec decision 4); each with the targets it is key for, so that an artwork whose
    // targets are chosen draws their keys alone (decision 19)
    const r = reviewRoot();
    const roots = r !== null ? [r] : Object.keys(page.review.data.targets).map((n) => page.g.byName.get(n)).filter((j): j is number => j !== undefined);
    const keys = new Map<number, number[]>();
    for (const t of roots) for (const k of flow.keys(t).keys) if (k !== t) keys.set(k, [...(keys.get(k) ?? []), t]);
    const onBoard = (k: number) => G.byName.get(page.g.nodes[k].name);
    const drawn = [...keys].flatMap(([k, ts]) => {
      const j = onBoard(k);
      return j === undefined ? [] : [{ j, of: ts.map(onBoard).filter((t): t is number => t !== undefined) }];
    });
    canvas.setKeys(
      drawn.map((d) => d.j),
      drawn.map((d) => d.of),
    );
    legend.render();
    // an artwork's targets by selection list them
    art.refresh();
  };
  page.syncStatus = syncStatus;

  // ---------------------------------------------------------------- the colour scheme
  //
  // Kind or Status (CanvasSpec, "Colour schemes"): the reader's own, kept apart for a board where the
  // review has a focus (Status unless the reader chose otherwise there) and for every other (Kind).
  // Like the edges, and unlike the theme, it is what the board shows: followed (CollabSpec decision
  // 4), never shared on the board.

  /** The review has a focus on the board on show: where the review strip shows. */
  const onReview = () => reviewRoot() !== null;
  /** the reader's own colouring here, under an artwork's (drawLook) */
  const ownScheme = () => store.schemeFor(onReview());
  page.ownScheme = ownScheme;
  const applyScheme = () => {
    canvas.setScheme(page.artLook?.scheme ?? ownScheme());
    legend.render();
  };
  const chooseScheme = (s: Scheme) => {
    store.setScheme(onReview(), s);
    applyScheme();
    people.report();
  };
  page.chooseScheme = chooseScheme;
  const legend = new Legend($("#legend"), {
    scheme: () => canvas.scheme,
    setScheme: chooseScheme,
    counts: () => canvas.counts(),
    isOpen: () => !!S.legend,
    setOpen: (open) => {
      S.legend = open;
      store.save();
    },
    keyEdges: () => S.mode === "keys",
  });
  page.legend = legend;
  /** What those following this reader see (CollabSpec decision 4, the owner's decision of
   *  2026-10-11: what you see is followed), part by part as web/src/surfaces.ts declares them: how
   *  each is read into presence, and how a followed reader's is applied here — the place's parts
   *  together (`follow`, below), the others each on its own. */
  const parts: PageParts = {
    read: {
      view: () => ({ view: nav.board.id, scope: nav.query(), clusterMode: cm() }),
      // in the Time Machine, the build browsed (HistorySpec decision 18)
      history: () => (tm.active && tm.snapshot !== null ? { history: { snapshot: tm.snapshot } } : {}),
      camera: () => ({ cam: { ...canvas.cam } }),
      tool: () => ({ mode: S.mode }),
      selection: () => ({ selection: selectionText(page.picks) }),
      // the reader's own focus, where they chose one (ViewSpec decision 28), and their visitors
      // (decision 27)
      focus: () => (page.mine !== undefined ? { focus: page.mine } : {}),
      visitors: () => (page.visitors.length ? { visitors: shareVisitors(page.visitors, (k) => canvas.visitorPos(k)) } : {}),
      panel: () => ({ sel: page.shown && "decl" in page.shown ? page.shown.decl : null }),
      // the source windows, the following one and those pinned (decided 2026-10-09)
      sources: () => ({
        source: sources.open,
        ...(sources.following?.collapsed ? { sourceCollapsed: true } : {}),
        ...(sources.pinned.length ? { pinned: sources.pinned.map((p) => ({ decl: p.name, collapsed: p.collapsed })) } : {}),
      }),
      // the reference window (AttachmentSpec decision 11)
      paper: () => (papers.state() ? { paper: papers.state()! } : {}),
      activity: () => ({ activity: activity.state() }),
      lostFound: () => ({ lostFound: { open: lostDrawer.open } }),
      // the reader's own, under an artwork's, which the artwork's part carries
      colouring: () => ({ scheme: ownScheme() }),
      edges: () => ({ edges: S.showEdges }),
      linear: () => ({ linear: linear.shown }),
      artwork: () => ({ artwork: art.view() }),
    },
    // what this page shows is this reader's own once following ends, so it is kept as shown: the
    // colouring and the edges in this browser, as the reader's own choice is
    apply: {
      activity: (v) => activity.mirror(v.activity!),
      lostFound: (v) => lostDrawer.toggle(v.lostFound!.open),
      colouring: (v) => {
        if (ownScheme() !== v.scheme) chooseScheme(v.scheme!);
      },
      edges: (v) => page.setEdges(v.edges!),
      linear: (v) => (v.linear ? void linear.show("followed") : linear.hide("reader", "followed")),
      artwork: (v) => art.follow(v.artwork ?? null),
    },
  };
  page.parts = parts;
  /** Where this page is: what the others are told, and what Share tells an agent. */
  const whereIAm = (): PresenceView => presenceOf(parts.read, nav.tabs.map((t) => t.id));
  /** The declaration a name in an agent's message stands for: a full name, or the one declaration
   *  whose name ends with it; null where there is none, or several. */
  const resolveName = (name: string): string | null => {
    if (!/^[\p{L}\p{N}_'!?.«»₀-₉]+$/u.test(name)) return null;
    if (page.g.byName.has(name)) return name;
    const tail = "." + name;
    let found: string | null = null;
    for (const n of page.g.nodes)
      if (n.name.endsWith(tail)) {
        if (found) return null;
        found = n.name;
      }
    return found;
  };
  // the conversations (CollabSpec decision 13, web/src/talk.ts): Everyone and the reader's own
  // agents, in the window the reader opens, moves, resizes and collapses (chatWin, above). A link
  // followed from a message — a declaration, a link of this site — is the reader's own tool changing
  // what is followed: it ends following (decision 4), and nothing else there does
  const talk = new Talk($("#convo"), {
    data,
    store,
    win: chatWin,
    me: () => ({ name: people.name, person: people.person?.id ?? null }),
    ensureName: () => people.ensure(),
    place: whereIAm,
    peers: () => people.peers,
    resolve: resolveName,
    go: (name) => {
      people.unfollow();
      const i = page.g.byName.get(name);
      if (i !== undefined) page.go(i);
    },
    open: (hash) => {
      people.unfollow();
      page.openAddress(hash);
    },
    chip: (url) => chipFor(url),
    seenLink: async () => copyLink({ origin: site.base, pathname: location.pathname }, await page.seenHash()),
    unkeyed: (text) => withoutKeys(text, site.origins),
    counted: (n, marked) => {
      const badge = $("#talk-badge");
      badge.hidden = n === 0;
      badge.textContent = n > 99 ? "99+" : String(n);
      $("#talk-at").hidden = !marked;
      $("#talk-btn").title = `Conversations: everyone on this page, and your agents${n ? ` — ${n} new in Everyone` : ""}${marked ? "; you were mentioned, or an agent of yours answered" : ""}`;
    },
    mentioned: (channel, m) => mentionNotice(channel, m),
  });
  page.talk = talk;
  if (kept) talk.restoreDrafts(kept.talk);
  /** The conversation button: the window opened, expanded; open and expanded, closed. A read-only
   *  reader has none (CollabSpec decision 11), nor has a snapshot. */
  const talkBtn = $("#talk-btn");
  talkBtn.hidden = !!reader || !!data.snapshot;
  talkBtn.addEventListener("click", () => {
    if (chatWin.open && !chatWin.collapsed) chatWin.close();
    else chatWin.show(true);
  });
  /** A mention of the reader where they do not read: a notice under the button, which opens the
   *  window on it, for a while. */
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  let noticeOf = PUBLIC;
  const mentionNotice = (channel: string, m: ChatMessage) => {
    const el = $("#talk-notice");
    noticeOf = channel;
    el.innerHTML = `<b>${escapeHtml(m.from)}</b> mentioned you${channel === PUBLIC ? " in Everyone" : ""}: “${escapeHtml(excerpt(m.text, 90))}”`;
    el.title = "Open the conversation";
    el.hidden = false;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (el.hidden = true), 12_000);
  };
  $("#talk-notice").addEventListener("click", () => {
    $("#talk-notice").hidden = true;
    talk.open(noticeOf);
  });
  // left open by the reader: open again, as they left it
  if (store.data.chatOpen && !talkBtn.hidden) chatWin.show();
  /** A link of this site's chip (CollabSpec decision 13, web/src/chatlinks.ts): named by what the page
   *  knows — a view's title, a note's words; null for any other link and one it cannot read. */
  const chipFor = (url: string): Chip | null => {
    const l = siteLink(url, site.origins);
    if (!l) return null;
    return chipOf(l, {
      view: (id) => (id === PROJECT ? "the Project" : views.summary(id) ? views.title(id) : null),
      note: (id, ofView, view) => {
        const text = ofView ? (view ? views.rec(view)?.notes?.find((n) => n.id === id)?.text : undefined) : projectNotes.get(id)?.text;
        return text ? noteExcerpt(text, 40) : null;
      },
      tool: (t) => (restsOn(t) ? "Rests on" : MODE_NAME[t]),
    });
  };
  page.chipFor = chipFor;

  // ---------------------------------------------------------------- who is here
  //
  // The reader's name (CollabSpec decision 3) at the top right, and the others on the server
  // (decision 4): their initials beside it, their selections on the canvas and in the panel, and
  // following one of them — to their view, opened in a tab if need be (ViewSpec decision 10).

  /** A reader's place in words: "Review ★fermatLastTheoremFour, looking at not_fermat_42". */
  const describePlace = (v: PresenceView): string => {
    const name = (m: string) => (TOOLS.includes(m as Tool) ? toolName(m as Tool) : m);
    const parts: string[] = [];
    const on = views.nameOf(v);
    if (on) parts.push(on);
    // in the Time Machine, at a build (HistorySpec decision 18)
    if (v.history) {
      const s = tm.snaps.find((x) => x.id === v.history!.snapshot);
      parts.push(`in the Time Machine at ${s ? buildWhen(s.at) : `build ${v.history.snapshot}`}`);
    }
    if (v.sel) parts.push(`${v.source ? "reading the source of" : "looking at"} ${short(v.sel)}`);
    return parts.join(", ") || `the whole project, ${name(v.mode)}`;
  };
  const people: People = new People(data, store, {
    view: whereIAm,
    say: (text) => say(text),
    describe: (v) => describePlace(v),
    follow: (v) => {
      artReach();
      void goWhere(v, false);
    },
    changed: () => {
      syncPeers();
      peerMenu.render();
      if (!reader) talk.peersChanged();
    },
    // the windows that stood for the followed reader's are this reader's own now, and none says any
    // more that the reader follows someone; what following left is theirs to leave (CollabSpec, "What
    // following leaves"): the artwork mode's bar, all but Share and Search out of reach again; the
    // linear form, which nothing on the screen says how to put away — the line does, once
    unfollowed: () => {
      sources.release();
      papers.unfollowed();
      artReach();
      if (!people.following && linear.followed && !exportModal.isOpen) say(`The board stays in the linear form you followed: ${isPhone() ? "⋯ at the bottom → Linear form puts" : "o, or ⋯ at the bottom → Linear form, puts"} it away.`);
    },
    // what is left to review where the review has a focus is the reader's own; who may read which of
    // the conversations, theirs
    renamed: () => {
      showSelected();
      renderStrip();
      if (!reader) talk.identity();
    },
    // asking others to follow (CollabSpec decision 10): Esc declines a request shown, unless it is
    // typed into a field or pressed in a menu or a dialog, whose own it is
    escape: (e) => {
      const t = e.target as Element | null;
      return asking.banner.escape({ field: typing(t) || typing(document.activeElement), menu: !!t?.closest?.('[role="menu"], [role="dialog"], #modal, #help') });
    },
    menu: (key, at) => {
      if (!people.people().some((x) => x.key === key)) return false;
      peerMenu.toggle(key, at);
      return true;
    },
    asked: (p) => askMark(asking.tally.stateOf(p.sessions.map((x) => x.id)), p.name ?? "This reader"),
    askAll: () => void asking.ask(null),
    askWhy: () => (reader ? READ_ONLY : asking.why(true)),
  });
  page.people = people;
  // known before its stream says hello, so that a read-only page never sends a heartbeat
  if (reader) people.readOnly = reader;
  /** Asking others to follow, and being asked (CollabSpec decision 10, web/src/askfollow.ts): the
   *  banner of a request shown, the outcome of this reader's own on the initials and in a line. */
  const asking = new Asking($("#ask-banner"), $("#ask-line"), {
    data,
    stream: () => people.stream,
    ensureName: () => people.ensure(),
    lost: () => people.lost(),
    isPrivate: () => people.isPrivate,
    others: () => people.people().filter((p) => !p.agent).length + people.privateOthers,
    keyOf: (a: AskFollow) => personKey({ id: a.from, name: a.name, agent: a.agent, verified: a.verified }),
    following: (key) => people.followedKey === key,
    present: (key) => people.people().some((p) => p.key === key),
    follow: (key) => people.follow(key),
    personOf: (id) => people.people().find((p) => p.sessions.some((x) => x.id === id))?.key ?? null,
    changed: () => people.renderPeers(),
    say: (text) => say(text),
  });
  page.asking = asking;
  /** The menu a click on a person's initials opens: follow them, or ask them to follow this reader
   *  (web/src/peermenu.ts). */
  const peerMenu = new PeerMenu($("#peer-menu"), $("#peers").parentElement!, {
    person: (key) => {
      const p = people.people().find((x) => x.key === key);
      if (!p) return null;
      const s = p.sessions[0];
      const v = s.view;
      // an agent: talked with in its maker's private channel, else mentioned in Everyone; none by a
      // read-only reader, nor with an agent without a token (AgentSpec decision 8)
      const own = !!s.talk && ownAgents([s], { name: people.name, person: people.person?.id ?? null }).length > 0;
      const agent = p.agent ? { talk: reader || !s.talk ? null : own ? ("own" as const) : ("public" as const), state: s.talk ? stateWords(s.talk) : null } : undefined;
      return { name: p.name ?? "this reader", html: p.name ? escapeHtml(p.name) + (p.verified ? VERIFIED : "") : "A reader without a name", color: people.colorOf(p), where: v ? describePlace(v) : "", following: people.followedKey === key, ...(agent ? { agent } : {}) };
    },
    follow: (key) => people.follow(key),
    talk: (key) => {
      const s = people.people().find((x) => x.key === key)?.sessions[0];
      if (!s?.talk || reader) return;
      if (ownAgents([s], { name: people.name, person: people.person?.id ?? null }).length) talk.open(s.id);
      else talk.open(PUBLIC, s.name ?? undefined);
    },
    ask: (key) => {
      const p = people.people().find((x) => x.key === key);
      if (p) void asking.ask({ id: p.sessions[0].id, name: p.name ?? "This reader" });
    },
    cannotAsk: () => (reader ? READ_ONLY : asking.why(false)),
  });
  /** Go where a reader's followed state says (CollabSpec decision 4): their view (a tab opened for it
   *  if need be), their tool, their selection (from before selections were queries, or from an agent
   *  that does not say: what their panel tells of, under their tool), camera and source window — the
   *  place, in one step — then the build they browse, and the other parts each that they say.
   *  Following does it each time the followed reader moves; a link with a snapshot of what its sharer
   *  saw does it once (`once`, the owner's decision of 2026-10-12), and the reader is free after it:
   *  where its view is gone, the place is taken on the board on show. Resolves to whether the view
   *  was reached. */
  const goWhere = async (v: PresenceView, once: boolean): Promise<boolean> => {
    const mode = TOOLS.includes(v.mode as Tool) ? (v.mode as Tool) : S.mode;
    const { id, scope } = views.whereIs(v);
    // under Keys, whose key declarations is the view's to say: its focus to begin with, the target
    // linked to it first where nothing set it
    const rec = id ? views.rec(id) : undefined;
    const reviewed = rec ? focusFrom(rec) ?? null : null;
    const chosen = v.selection !== undefined ? readSelection(v.selection) : v.sel ? [declPick(mode, v.sel, keysFor({ decl: v.sel }, reviewed))] : [];
    // and their own focus, where they chose one (ViewSpec decision 28)
    const to: Place = { mode, picks: selectionText(chosen), shown: v.sel ? { decl: v.sel } : shownOf(chosen.at(-1)), cam: v.cam, ...(v.focus !== undefined ? { focus: v.focus } : {}), visitors: readVisitors(v.visitors) };
    // views are not switched in the Time Machine: it is left first, and opened again there
    if (tm.active && id !== tm.view) await tm.close();
    if (id === nav.board.id) page.place(to, false);
    else if (!(id && (await nav.select(id, to))) && scope) await nav.open(scope, to);
    const reached = nav.board.id === id || (scope !== null && nav.query() === scope);
    if (once && !reached) page.place(to, false);
    // following ended while their view was being opened (the reader's own act): nothing more of the
    // followed reader's is taken — their build, their windows —, and the windows the reader has
    // opened since are their own, nothing of the followed reader's closing them (CollabSpec, "What
    // following leaves")
    const ended = () => !once && !people.following;
    // where they are in the Time Machine (HistorySpec decision 18): the same build, or none
    if (!ended()) {
      if (v.history) {
        if (!tm.active) await tm.open({ snapshot: v.history.snapshot });
        else if (tm.snapshot !== v.history.snapshot) await tm.show(v.history.snapshot);
      } else if (tm.active) await tm.close();
    }
    page.writeAddress(false);
    if (ended()) return reached;
    // what their panels and their board show besides: Activity, the lost-and-found, the colouring,
    // the edges — each their page says (an older one says none: this reader's stay)
    applyOwn(v, parts.apply);
    // their reference window, as theirs is; from a link, once the source windows are open, whose
    // pairing would otherwise open another beside them
    if (!once) papers.mirror(v.paper);
    // their source windows, mirrored in this reader's, each where this page puts it: the one
    // following their selection, and those they pinned that this page's graph has; a past build
    // has none
    if (!pastShown())
      sources.mirror({
        following: v.source ? { decl: selected(), collapsed: v.sourceCollapsed === true } : null,
        pinned: (v.pinned ?? []).flatMap((w) => {
          const i = page.g.byName.get(w.decl);
          return i === undefined ? [] : [{ decl: i, collapsed: w.collapsed }];
        }),
      });
    if (once) {
      papers.mirror(v.paper);
      // the windows are this reader's own from now on, as when following ends
      sources.release();
      papers.unfollowed();
    }
    return reached;
  };

  /** Open a link's snapshot of what its sharer saw (CollabSpec decision 7, the owner's decision of
   *  2026-10-12), on the board its address opened: what still makes sense is applied once, as
   *  starting to follow applies it, the camera framing the region of the board the sharer framed;
   *  one short line says what could not be shown. */
  const openSnapshot = async (text: string) => {
    const shot = await readSnapshot(text, canvas.screen);
    if (!shot) return say("This link's snapshot of what its sharer saw could not be read: it opens on its view alone.");
    // the build browsed, the reference window's file and its link, where they are still here
    if (shot.view.history) await tm.load();
    const { view, gone } = sortOut(shot.view, { build: (id) => tm.snaps.some((s) => s.id === id), file: (sha) => !!fileOf(page.review.data, sha), link: (id) => !!linkOf(page.review.data, id) });
    const v: PresenceView = { mode: S.mode, sel: null, source: false, clusterMode: cm(), cam: null, view: nav.board.id, scope: null, tabs: [], ...view };
    // a view nobody keeps was opened by the address's query, at the build it carries: the snapshot's
    // id for it may be gone, its query is the same
    if (v.scope && nav.query() === v.scope) v.view = nav.board.id;
    gone.view = !(await goWhere(v, true));
    // what the board's graph (a past build's, in the Time Machine) does not hold, and a focus on what
    // is no target now
    const picked = readSelection(v.selection).flatMap((p) => (p.root && "decl" in p.root ? [p.root.decl] : []));
    Object.assign(gone, goneNames(v, picked, { decl: (n) => page.g.byName.has(n), target: (n) => Object.hasOwn(page.review.data.targets, n) }));
    // the region framed again, now that the panels the snapshot opened leave the board its room
    if (shot.region) {
      syncInsets();
      canvas.jumpTo(camOf(shot.region, canvas.screen));
    }
    // an artwork's frame holds what the sharer's held
    if (v.artwork) art.follow(v.artwork);
    const line = missingLine(gone);
    if (line) say(line);
  };
  page.openSnapshot = openSnapshot;
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
  // a layout's memory is handed over under a name, or by a private reader, as the server takes it
  page.handsOver = () => !reader && (!!data.snapshot || !!people.name || !!data.privateSession);
  /** The others' selections on the canvas, and who else is on the declaration in the panel. */
  const syncPeers = () => {
    const marks: { i: number; color: string; label: string }[] = [];
    for (const p of people.people()) {
      const seen = new Set<number>();
      for (const s of p.sessions) {
        const i = s.view?.sel ? page.g.byName.get(s.view.sel) : undefined;
        if (i === undefined || seen.has(i)) continue;
        seen.add(i);
        const j = toView(i);
        if (j >= 0) marks.push({ i: j, color: people.colorOf(p), label: people.label(p) });
      }
    }
    canvas.setPeers(marks);
    panel.refreshAlsoHere();
  };

  // ---------------------------------------------------------------- the tabs
  //
  // The views this reader has open, and the views menu (web/src/tabs.ts).

  /** A new view or a copy, under the reader's name (it is recorded), shown in a tab. */
  const made = async (r: ViewAnswer): Promise<string | null> => {
    if (r.who) people.lost();
    if (!r.view) return r.error ?? "The view could not be made.";
    if (tm.active) await tm.close();
    await views.load();
    if (await nav.show(r.view.id, null)) page.commit();
    sync.afterPost();
    return null;
  };
  page.made = made;
  // a private reader's view is made without their name, and needs none (CollabSpec decision 8)
  const named = async (): Promise<string | null> => (reader ? READ_ONLY : data.snapshot || (await people.ensureLayout()) ? null : "A view is made under your name: give one first.");
  page.named = named;
  const tabs = new Tabs($("#tabs"), $("#views-btn"), $("#views-menu"), {
    tabs: () => nav.tabs,
    active: () => nav.board?.id ?? null,
    // a tab of a view the server forgot is called by its query, at the build it shows
    title: (id) => {
      const t = !views.summary(id) && !views.rec(id) ? nav.tabs.find((x) => x.id === id) : undefined;
      return t?.q ? titleOfScope(t.q, views.titles(), t.at) : views.title(id);
    },
    tip: (id) => views.tip(id, nav.tabs.find((x) => x.id === id)?.q),
    summary: (id) => views.summary(id),
    list: () => views.summaries,
    select: (id) => void openView(id),
    close: (id) => void nav.close(id).then(() => page.writeAddress(false)),
    create: async (name) => (await named()) ?? made(await views.post("create", { name })),
    duplicate: async (name) => (await named()) ?? made(await views.post("create", { name, from: nav.board.id })),
    rename: async (name) => {
      const why = await named();
      if (why) return why;
      const r = await sync.change("rename", { name });
      if (r.error) return r.error;
      nav.board.rec.name = name;
      nav.board.rec.kept = true;
      renderTabs();
      boardPanel.render();
      return null;
    },
    remove: async () => {
      const why = await named();
      if (why) return why;
      const id = nav.board.id;
      const r = await sync.change("delete", {});
      if (r.error) return r.error;
      await nav.close(id);
      page.writeAddress(false);
      return null;
    },
    readOnly: () => !!data.snapshot || !!reader,
    frozen: () => (reader ? READ_ONLY : null),
    build: (id) => {
      const s = tm.snaps.find((x) => x.id === id);
      return s ? `${buildWhen(s.at)}${s.commit ? ` · ${s.commit.hash.slice(0, 7)}` : ""}` : null;
    },
    short: (t) => views.titles().names?.decl(t) ?? short(t),
    // the reader's focus, where its view is another than this one (ViewSpec decision 29)
    linkable: () => {
      const t = nav.board ? reviewName() : null;
      if (t === null || views.linkedTo(t) === nav.board.id) return null;
      return { target: t, why: linkWhy(t) };
    },
    link: (t) => linkTo(t),
  });
  page.tabs = tabs;

  // the review's focus on the board on show, in the view's header (ViewSpec decision 28;
  // web/src/focus.ts): the view's own, everyone's, or the reader's, theirs as the camera is
  const focusMenu = new FocusMenu($("#focus-btn"), $("#focus-menu"), {
    state: () => (nav.board ? { view: viewFocusName(), mine: page.mine, focus: reviewName(), linked: linkedTargets(), held: heldTargets() } : null),
    short: (name) => views.titles().names?.decl(name) ?? short(name),
    choose: (f) => {
      page.mine = f;
      page.apply();
      page.writeAddress(false);
    },
    setView: async (f) => {
      if (frozen()) return frozenWhy();
      const why = await named();
      if (why) return why.replace("A view is made", "The view's focus is set");
      const r = await sync.change("focus", { focus: f });
      if (r.error) return r.error;
      nav.board.rec.focus = f;
      // the reader's focus is the view's now: nothing of their own is left
      page.mine = undefined;
      page.apply();
      page.writeAddress(false);
      return null;
    },
    canSet: () => !frozen(),
  });
  page.focusMenu = focusMenu;

  // the targets at the top of the side panel, each opening its view (web/src/targetlist.ts)
  const targetList = new TargetList($("#targets"), {
    readOnly: () => !!data.snapshot || !!reader,
    list: () => views.summaries,
    targets: () => Object.keys(page.review.data.targets),
    active: () => nav.board?.id ?? null,
    progress: (t) => {
      const i = page.present.byName.get(t);
      return i === undefined ? null : flowNow.progress(i);
    },
    keyProgress: (t) => {
      const i = page.present.byName.get(t);
      return i === undefined ? null : flowNow.keyProgress(i);
    },
    open: (id, target) => openTarget(id, target),
    title: (id) => views.title(id),
    shut,
    toggle: toggleSection,
  });
  /** The tabs, and the targets beside them: both follow the views and how far each review has come. */
  function renderTabs(): void {
    tabs.render();
    targetList.render();
  }

  /** Open a view (a tab, a row of the menu, an event of the timeline): one step in the history. */
  const openView = async (id: string) => {
    if (id === nav.board.id) return stay();
    if (noSwitch()) return;
    if (await nav.select(id)) page.commit();
  };
  /** A target, from the targets list: its view, on the target, or, with none (`id` null), a view
   *  nobody keeps of its TCB, linked to it (see reviewTarget); a target no longer in the graph opens
   *  its view alone, and with none has nowhere to go. */
  const openTarget = (id: string | null, target: string) => {
    if (id !== null && id !== nav.board.id && noSwitch()) return;
    const i = page.g.byName.get(target);
    if (i !== undefined) reviewTarget(i);
    else if (id !== null) void openView(id);
    else say(`★${short(target)} is not in the graph now, and has no view.`);
  };

  // ---------------------------------------------------------------- what happened
  //
  // The timeline (CollabSpec decision 5) in a drawer on the right. What "My targets" and a build's
  // warning look at: each target's TCB, its declarations and their modules, worked out once per
  // graph and review — on the graph on show, whatever build the board shows: the timeline is the
  // review's, which does not depend on the board.

  const targetTcbs = new Map<string, { names: Set<string>; modules: Set<string> } | null>();
  page.targetTcbs = targetTcbs;
  const tcbOfTarget = (name: string) => {
    if (!targetTcbs.has(name)) {
      const i = page.present.byName.get(name);
      if (i === undefined) targetTcbs.set(name, null);
      else {
        const seen = page.present.reach([i], SITE_STMT | SITE_BODY, "out");
        const names = new Set<string>(), modules = new Set<string>();
        for (let j = 0; j < seen.length; j++)
          if (seen[j]) {
            names.add(page.present.nodes[j].name);
            if (!page.present.isExt(j)) modules.add(page.present.nodes[j].module);
          }
        targetTcbs.set(name, { names, modules });
      }
    }
    return targetTcbs.get(name) ?? null;
  };
  // a link to this view that lets whoever has it in, or a prompt for an AI agent with a token of its
  // own (web/src/share.ts); a snapshot is shared as a file
  new Share($("#share-btn"), $("#share-pop"), {
    info: () => data.shareInfo(),
    // the guest link and a read-only reader's own at the public address, as the server makes the
    // others (CollabSpec decision 7)
    base: () => site.base,
    data,
    me: () => people.name,
    person: () => people.person?.id ?? null,
    ensureName: () => people.ensure(),
    // what the reader sees (the owner's decision of 2026-10-12): every followed part as the registry
    // reads it, the camera as the region of the board it shows
    snapshot: () => writeSnapshot(followedOf(parts.read), canvas.screen),
    exact: {
      get: () => S.shareExact !== false,
      set: (on) => {
        S.shareExact = on ? undefined : false;
        store.save();
      },
    },
  });
  if (data.snapshot) $(".share-wrap").hidden = true;
  // the document of the view on show, typeset on the server (ExportSpec decisions 5–16); a
  // snapshot has no server
  const exportModal = new ExportModal($("#export-btn"), $("#export-modal"), {
    view: () => {
      const b = nav.board;
      if (!b) return null;
      const m = b.rec.clustering;
      // the document is of the build the board shows (ExportSpec decision 16, the owner's of
      // 2026-10-10): a view kept at a past build is printed at it; a preview of the view at another
      // build than its own (the Time Machine) at the build on show, which the request names
      const past = b.past?.past ?? null;
      const version = b.preview ? (past?.snapshot.id ?? null) : undefined;
      const { version: _own, ...rec } = b.rec;
      const titled = version === undefined ? b.rec : { ...rec, ...(version !== null ? { version } : {}) };
      return {
        id: b.id,
        title: views.title(b.id),
        tip: views.tip(b.id),
        heading: docTitle(titled, views.titles()),
        fixed: b.rec.id === PROJECT,
        plan: planDoc(b.full, b.bs.set, m, b.rec.hidden[m]),
        ...(version !== undefined ? { version } : {}),
        ...(past ? { when: briefWhen(past.snapshot.at) } : {}),
      };
    },
    head: (view, version) => data.exportHead(view, version),
    saved: () => S.export as ReturnType<ExportHooks["saved"]>,
    save: (v) => {
      S.export = v;
      store.save();
    },
    start: (body) => data.exportDoc(body),
    poll: (id) => data.exportJob(id),
    // the window closing, following nobody, takes with it the form following left, which nobody here
    // asked for: the followed reader's own Export window drew it, as often as not (CollabSpec, "What
    // following leaves")
    shown: (open) => (open ? void linear.show("export") : people.following ? linear.hide("export") : linear.hide("export", "followed")),
    artwork: () => art.open(),
    artworkOnly: () => !!data.snapshot,
  });
  page.exportModal = exportModal;
  // a snapshot of the page carries the links, not the library's files (they are the server's)
  if (data.snapshot) $("#library-btn").hidden = true;

  // a view whose record this page holds says whether the note is on it; another, whether the view
  // is there; a note of the project (`view` ""), whether the project still has it
  const hasNote = (view: string, id: string): boolean => {
    if (view === "") return !!projectNotes.get(id);
    const r = views.rec(view);
    return r ? !!r.notes?.some((n) => n.id === id) : !!views.summary(view);
  };
  const showNote = (view: string, id: string): void => {
    // a note of the project: on the board on show where it holds it, else on the Project, which
    // holds what every note is about
    if (view === "") {
      if (stickies.has(id)) return stickies.flyTo(id);
      if (!projectNotes.get(id)) return say("That note is no longer the project's.");
      view = PROJECT;
    }
    // views are not switched in the Time Machine
    if (view !== nav.board.id && noSwitch()) return;
    void (view === nav.board.id ? Promise.resolve(true) : nav.select(view)).then((ok) => {
      if (!ok) return;
      if (view !== nav.board.id) page.commit();
      if (stickies.has(id)) stickies.flyTo(id);
      else say("That note is no longer on this view.");
    });
  };
  page.showNote = showNote;

  const activity = new Activity($("#activity"), $("#activity-btn"), $("#activity-badge"), store, {
    me: () => people.name,
    review: () => page.review.data,
    mine: (name) => {
      // the targets this reader marked, or the reader they took it from by following them: not
      // those an agent of the same name marked
      const targets = new Set(Object.entries(page.review.data.targets).filter(([, t]) => name !== null && t.by === name && !t.agent).map(([n]) => n));
      const names = new Set<string>(), modules = new Set<string>();
      for (const t of targets) {
        const s = tcbOfTarget(t);
        s?.names.forEach((n) => names.add(n));
        s?.modules.forEach((m) => modules.add(m));
      }
      return { targets, names, modules };
    },
    touching: (mods) => Object.keys(page.review.data.targets).filter((t) => mods.some((m) => tcbOfTarget(t)?.modules.has(m))),
    covering: (p) =>
      Object.keys(page.review.data.targets).filter((t) => {
        for (const n of tcbOfTarget(t)?.names ?? []) {
          const i = page.present.byName.get(n)!;
          if (covers(p, n, page.present.nodes[i].module, page.present.isExt(i))) return true;
        }
        return false;
      }),
    showPrefix: (p) => page.goToPrefix(p),
    has: (name) => page.g.byName.has(name),
    go: (name) => {
      const i = page.g.byName.get(name);
      if (i !== undefined) page.go(i);
    },
    comment: (text, name) => reviewBox.comment(text, name),
    openOpinion: (r) => reviewBox.jump(r, null, null),
    openSource: (r, quoted) => openSourceAt(r.name, r.from, r.to, quoted, null),
    reviewTarget: (name) => {
      const i = page.g.byName.get(name);
      if (i !== undefined) reviewTarget(i);
    },
    goToModule: (m) => page.goToModule(m),
    hasView: (id) => !!views.summary(id),
    openView: (id) => void openView(id),
    viewTitle: (id) => views.title(id),
    scopeTitle: (scope) => titleOfScope(scope, views.titles()),
    scopeTip: (scope) => views.tip("", scope),
    hasNote: (view, id) => hasNote(view, id),
    showNote: (view, id) => showNote(view, id),
    // the lost-and-found's drawer takes the same place: one of the two is open
    toggled: (open) => {
      if (open && lostDrawer.open) lostDrawer.toggle(false);
      syncInsets();
    },
    stateChanged: () => people.report(),
    migrations: () => lostDrawer.migrations(),
    openLost: (key) => lostDrawer.show(key),
    // a snapshot of the page has no reference window: its files and links are text there
    ...(data.snapshot ? {} : { openFile: (sha: string) => papers.openFile(sha), openLink: (id: string) => papers.openLink(id) }),
    // an agent's layout, put back: under the reader's name, as the timeline records it (a private
    // reader's, without one)
    undo: async (id) => {
      if (reader) return READ_ONLY;
      if (!(await people.ensureLayout())) return "An undo is recorded under your name: give one first.";
      const r = await data.undoLayout(id);
      if (r.who) people.lost();
      return r.error ?? null;
    },
  });
  page.activity = activity;

  // ---------------------------------------------------------------- the lost-and-found

  // what was said of declarations the graph no longer has (HistorySpec decisions 12–14), in a drawer
  // where Activity's is, opened from the build-status popover
  const lostDrawer = new LostAndFound($("#lostfound"), data.lost, {
    has: (name) => page.g.byName.has(name),
    go: (name) => {
      const i = page.g.byName.get(name);
      if (i !== undefined) page.go(i);
    },
    hasView: (id) => !!views.summary(id),
    openView: (id) => void openView(id),
    hasNote: (view, id) => hasNote(view, id),
    showNote: (view, id) => showNote(view, id),
    comment: (text, name) => reviewBox.comment(text, name),
    // Attach to…: a declaration of the graph, picked with the search, by its name now (a board of a
    // past build searches its own graph)
    pick: (prompt) => page.searchBox.pick(prompt).then((i) => (i === null ? null : declNow(i))),
    timeMachine: (at) => timeMachine(at),
    ensureName: () => people.ensure(),
    nameLost: () => people.lost(),
    toggled: (open) => {
      if (open && activity.open) activity.toggle(false);
      syncInsets();
      people.report();
    },
    changed: () => {
      activity.changed();
      if (!page.pop.hidden) page.renderPop();
    },
  });
  page.lostDrawer = lostDrawer;

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
    targetTcbs.clear();
    views.reviewChanged();
    if (views.board(nav.board.id) !== nav.board) void nav.redraw().then(() => boardPanel.render());
    syncStatus();
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
    activity.changed();
    boardPanel.render();
    renderTabs();
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
    const why = await named();
    if (why) return why;
    const s = tm.snaps.find((x) => x.id === snapshot);
    const taken = new Set(views.summaries.map((v) => views.title(v.id)));
    // "Project @ Oct 9 22:27": the view's title at that build, numbered only where that is taken
    const name = versionName(views.title(nav.board.id), s ? briefWhen(s.at) : `build ${snapshot}`, taken);
    const r = await views.post("create", { name, from: nav.board.id, version: snapshot });
    if (r.who) people.lost();
    if (!r.view) return r.error ?? "The view could not be made.";
    const at = page.here();
    await views.load();
    const id = r.view.id;
    const ok = await tm.leaveFor(() => nav.show(id, at));
    sync.afterPost();
    if (!ok) return `“${name}” is made, kept at that build: it is in Views.`;
    // the tabs were hidden while it was shown: drawn again now, its tab brought into sight
    renderTabs();
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
    exportModal.boardChanged();
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
    syncStatus();
    applyScheme();
    page.showLevel();
    syncPeers();
    boardPanel.render();
    renderHidden();
    page.apply();
    syncPast();
  };

  /** Open a target's view (ViewSpec decision 29): the view it is linked to, with a click on the
   *  target there under the Selection tool and the view brought to it, as going to a declaration
   *  does (`place`); on its view already, the target is gone to. A target with no view (marking makes
   *  none) is given one, as the owner decided on 2026-10-11: the view Zoom in on it under Rests on →
   *  TCB makes from the Project, `tcb(T)` at the latest build, nobody keeping it, linked to it and
   *  focused on it (shared/views.ts, `openTarget`) — opened as its view is, and its view for as long
   *  as it lasts. */
  const reviewTarget = (i: number) => {
    // a target renamed since: its view is linked to its name now
    const name = declNow(i);
    const linked = views.linkedTo(name);
    // a target's view opens with the target selected alone under the tool the reader has (the
    // owner's decision of 2026-10-12: the tool is never changed for them), and the target the
    // reader's focus there, whatever the view's own focus is (ViewSpec decisions 15 and 29); a
    // read-only reader, who opens no view (CollabSpec decision 11), goes to a target with none on
    // the board on show
    if ((linked !== undefined && targetStep(linked, nav.board.id) === null) || (linked === undefined && reader)) {
      page.mine = name;
      page.go(i);
      page.writeAddress(false);
      return;
    }
    if (noSwitch()) return;
    const p = pickDecl(name, name);
    const to: Place = { mode: S.mode, picks: selectionText([p]), shown: shownOf(p), cam: null, focus: name };
    if (linked !== undefined) {
      void nav.select(linked, to).then((ok) => {
        if (ok) page.commit();
        // its view deleted meanwhile: the target on the board on show
        else page.go(i);
      });
      return;
    }
    void (async () => {
      const v = await views.openTarget(name);
      if (typeof v === "string") return say(v);
      // the list holds the link before the server's word comes: the next click finds it there
      await views.load();
      renderTabs();
      if (!(await nav.select(v.id, to))) return;
      page.commit();
      if (!v.kept) say(`★${short(name)} had no view: this view of its TCB is its view while it lasts. Pin, fold or name it to keep it, and its link with it.`);
    })();
  };
  /** Why target `name` cannot be linked to the view on show now, or null (ViewSpec decision 29). */
  const linkWhy = (name: string): string | null => {
    if (data.snapshot) return null;
    if (frozen()) return frozenWhy();
    return linkRefused(nav.board.rec, name);
  };
  /** Link target `name` to the view on show, for everyone (ViewSpec decision 29): its clicks open this
   *  view; the view's first target is its focus to begin with, and one linked after leaves the focus
   *  as it is (the owner's decision of 2026-10-11); the view it was linked to keeps its scope and
   *  arrangement. Resolves to why it was refused, or null. */
  const linkTo = async (name: string): Promise<string | null> => {
    const no = linkWhy(name);
    if (no) return no;
    const why = await named();
    if (why) return why.replace("A view is made", "A target is linked to a view");
    const r = await sync.change("link", { target: name });
    if (r.error) return r.error;
    const rec = nav.board.rec;
    if (!rec.targets?.includes(name)) rec.targets = [...(rec.targets ?? []), name];
    if (rec.targets.length === 1) rec.focus = name;
    rec.kept = true;
    page.apply();
    renderTabs();
    say(`★${short(name)} is linked to this view now: clicking ★${short(name)} opens it.`);
    return null;
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
  if (snap) await openSnapshot(snap);
  // a link to a note (Copy link, CollabSpec decision 13): the note shown, on the board it opened
  const noteLink = noteIn(location.hash);
  if (noteLink) showNote(noteLink.ofView ? nav.board.id : "", noteLink.id);
  // the reader came to a place (a declaration, a view, what a sharer saw, an artwork): the welcome
  // stays quiet (GuideSpec decision 1)
  const deepLink = filmLink !== undefined || !!snap || !!noteLink || !!recipeIn(location.hash) || (!!linked && (!!linked.picks || !!linked.shown || (linked.view !== null && linked.view !== PROJECT) || !!linked.scope));
  // a link with an artwork's recipe (ExportSpec decision 20): once, after the board is there; the
  // files it asks for are saved meanwhile
  const recipe = recipeIn(location.hash);
  if (recipe) void openRecipe(recipe);
  // the builds the history holds: the clocks of views kept at one say which
  if (!data.snapshot) void tm.load().then(() => renderTabs());
  try {
    history.replaceState({ n: 0 }, "", "#" + encodeState(page.current()));
  } catch {
    // see writeAddress
  }
  page.renderNav();
  people.renderMe();
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
  void data.activity().then((events) => activity.load(events));
  // who this page is, then the others are told where it is; the camera and the source window
  // change without a step in the history, so they are looked at every second and a half
  void people.init().then(() => {
    people.start();
    // offered, never started by itself (GuideSpec decision 1); a link to the film opens it, at its
    // chapter: the visitor is watching already
    setTimeout(() => {
      page.guide.welcome(deepLink);
      if (filmLink !== undefined) page.guide.openHelp("tips", filmLink ? { chapter: filmLink } : {});
    }, 400);
    activity.changed();
    let last = "";
    setInterval(() => {
      const now = JSON.stringify(people.mode === "none" ? null : { s: sources.open, c: canvas.cam });
      if (now !== last) {
        last = now;
        people.report();
      }
    }, 1500);
  });
}

boot().catch((e) => console.error(e));
