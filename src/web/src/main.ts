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

import type { ClusterMode, Layout } from "../../shared/graph.ts";
import { lightUp, zoomScope } from "../../shared/board.ts";
import type { Lit } from "../../shared/board.ts";
import { printQuery, readsReview } from "../../shared/query.ts";
import { keyMarked, keyMarks } from "../../shared/review.ts";
import type { Query } from "../../shared/query.ts";
import { applyEvent, emptyReview, logFileName, problemsText, readEvent, validPersonId } from "../../shared/review.ts";
import type { ReviewChange, ReviewData, ReviewEvent, ReviewRequest, ReviewWhole } from "../../shared/review.ts";
import { briefWhen } from "../../shared/titles.ts";
import { PROJECT, versionName, viewFocus } from "../../shared/views.ts";
import { dataSource } from "./data.ts";
import { WholeReview } from "./reviewread.ts";
import type { DataSource, ReviewState } from "./data.ts";
import { exactContext, judgedText } from "../../shared/context.ts";
import type { ModuleContexts } from "../../shared/context.ts";
import type { DeclarationText } from "../../shared/excerpt.ts";
import { Graph } from "../../shared/viewgraph.ts";
import { ProjectNotes } from "./projectnotes.ts";
import { READ_ONLY } from "./people.ts";
import { deployWaiting } from "./buildpop.ts";
import { Editor } from "./editor.ts";
import { keptFocus, readerFocus } from "./focus.ts";
import { ReviewBox } from "./reviewbox.ts";
import { ReviewFlow } from "./reviewqueue.ts";
import { clusterPick, declPick, selectionQuery } from "./selection.ts";
import type { KeysOf, Pick, Root } from "./selection.ts";
import { takeKept } from "./reload.ts";
import type { Kept } from "./reload.ts";
import { snapshotIn } from "../../shared/sharesnap.ts";
import { recipeIn } from "../../shared/artrecipe.ts";
import { noteIn, siteOrigins } from "./chatlinks.ts";
import { decodeState, encodeState, tipsIn } from "./state.ts";
import { Store } from "./store.ts";
import { ViewNav } from "./viewnav.ts";
import type { Place } from "./viewnav.ts";
import { Views } from "./views.ts";
import { LayoutQueue } from "./layoutqueue.ts";
import type { LayoutWorker } from "./layoutqueue.ts";
import type { Board } from "./views.ts";
import { TimeMachine } from "./timemachine.ts";
import type { TimeMachineAt } from "./timemachine.ts";
import { boardMarks, reviewThen } from "./past.ts";
import type { PastGraph } from "./past.ts";
import { $, VIEW_GONE, PAST_REVIEW, READ_ONLY_REVIEW } from "./page.ts";
import type { GraphInfo, Page } from "./page.ts";
import { panelsPart } from "./pagepanels.ts";
import { boardPart } from "./pageboard.ts";
import { artPart } from "./pageart.ts";
import { sidePart } from "./pageside.ts";
import { layoutPart } from "./pagelayout.ts";
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
  editedNow: (i: number) => boolean | null;
  edited: (i: number) => Promise<boolean>;
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
  walk: (i: number) => void;
  reviewBox: ReviewBox;
  declNow: (i: number) => string;
  clickedDecls: () => number[];
  keyMarking: () => { target: string; fresh: number; already: number; names: string[] } | null;
  toggleKey: (i?: number | null) => void;
  litOn: (q: Query) => Lit;
  zoomOf: (q: Query | null, lit?: Lit | null) => Query | null;
  renderStrip: () => void;
  syncFocus: () => void;
  timeMachine: (at?: TimeMachineAt) => void;
  wholeReview: WholeReview<ReviewWhole>;
  takeChange: (c: ReviewChange) => void;
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
  let visitorsOn = "";
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
  page.editedNow = editedNow;
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
  page.edited = edited;
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
    const cl = page.canvas.layout.clusters[c];
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
  page.walk = walk;

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
    said: (text) => page.say(text),
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
    linkHere: (i) => void page.linkTo(declNow(i)).then((why) => why && page.say(why)),
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
              else if (typeof ok === "string") page.say(ok);
            });
          },
        }),
    go: (i) => page.go(i),
    openSource: (name, from, to, quoted, root) => page.openSourceAt(name, from, to, quoted, root),
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
  const toggleKey = (i = page.selected()) => {
    const r = reviewRoot();
    if (r === null || i === null || i === r || data.snapshot) return;
    if (reader) return page.say(READ_ONLY);
    if (pastShown()) return page.say(PAST_REVIEW);
    if (!flow.keyable(r, i)) return page.say(`${page.g.short(i)} is not in ${page.g.short(r)}'s TCB: only what it holds can be key for it.`);
    const target = page.g.nodes[r].name;
    void page.people.ensure().then((me) => {
      if (!me) return;
      void submit({ op: "key", target, name: page.g.nodes[i].name, on: !keyMarked(page.review.data, target, page.g.nodes[i].name) }).then((why) => why && page.say(why));
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
  Object.assign(page, panelsPart(page));

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
  Object.assign(page, boardPart(page));
  Object.assign(page, artPart(page));
  /** the board the notes were last drawn for */
  let stickiesOn = "";
  Object.assign(page, sidePart(page));
  Object.assign(page, layoutPart(page));

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
    if (views.board(nav.board.id) !== nav.board) void nav.redraw().then(() => page.boardPanel.render());
    page.syncStatus();
    page.trust.reviewChanged();
    page.renderTrusted();
    // what is lit reads the review when a pick does (key declarations, trust, statuses), and the
    // key graph's edges under Keys always: lit again; else what shows the review is drawn again
    const q = selectionQuery(page.picks);
    if (followed || S.mode === "keys" || (q && readsReview(q))) page.apply();
    else {
      page.outline.render();
      // a visitor's colour by status, and its diamond, are the review's too
      page.drawVisitors();
      renderStrip();
      page.showSelected();
      page.renderSelBar();
    }
    page.activity.changed();
    page.boardPanel.render();
    page.renderTabs();
    page.papers.refresh();
    // what notes carry is drawn from the library's records, which are the review's
    page.stickies.render();
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
    page.panel.g = page.g;
    reviewBox.g = page.g;
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

  /** Views are not switched in the Time Machine (HistorySpec decision 16): true, and the reader is
   *  told so, while it is open. */
  const noSwitch = (): boolean => {
    if (!tm.active) return false;
    page.say("Views are not switched in the Time Machine: leave it first (Esc).");
    return true;
  };
  page.noSwitch = noSwitch;

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
    page.sync.afterPost();
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
  (window as unknown as { visualproof: object }).visualproof = { canvas: page.canvas, linear: page.linear, graph: () => page.g, present: () => page.present, board: () => nav.board, views, tm, timeMachine: (at?: TimeMachineAt) => openTimeMachine(at) };
  window.addEventListener("resize", page.syncInsets);
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
  if (notOpened) page.say(notOpened);
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
  if (recipe) void page.openRecipe(recipe);
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
    page.sources.mirror({ following: f, pinned: kept.sources.pinned.map(on).filter((w) => w !== null) });
    page.sources.release();
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
      const now = JSON.stringify(page.people.mode === "none" ? null : { s: page.sources.open, c: page.canvas.cam });
      if (now !== last) {
        last = now;
        page.people.report();
      }
    }, 1500);
  });
}

boot().catch((e) => console.error(e));
