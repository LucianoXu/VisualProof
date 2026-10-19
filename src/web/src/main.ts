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

import type { BuildDelta, BuildRev, BuildStatus } from "../../shared/build.ts";
import type { ChatEvent, ChatMessage, Invited, PresenceView, PrivateCount, StreamHello } from "../../shared/collab.ts";
import { artNameId } from "../../shared/collab.ts";
import type { ClusterMode, GitSource, Layout, ViewMeta } from "../../shared/graph.ts";
import { SITE_BODY, SITE_GRAMMAR, SITE_PROOF, SITE_STMT } from "../../shared/graph.ts";
import { lightUp, zoomScope } from "../../shared/board.ts";
import type { Lit } from "../../shared/board.ts";
import { evaluate, parseQuery, printQuery, readsReview, sameQuery, setOutside, withoutOutside } from "../../shared/query.ts";
import { litKeyEdges } from "../../shared/keys.ts";
import { keyMarked, keyMarks, under, validPrefix } from "../../shared/review.ts";
import type { Query } from "../../shared/query.ts";
import { applyEvent, covers, emptyReview, logFileName, problemsText, readEvent, validPersonId } from "../../shared/review.ts";
import type { ReviewChange, ReviewData, ReviewEvent, ReviewRequest, ReviewRev } from "../../shared/review.ts";
import { reviewCount, trustSplit } from "../../shared/reviewqueue.ts";
import { scopeWith, scopeWithout } from "../../shared/scopeedit.ts";
import { newNoteId, noteExcerpt, withCarry } from "../../shared/sticky.ts";
import type { NoteCarry, NoteOp, StickyNote } from "../../shared/sticky.ts";
import type { ProjectNote, ProjectNoteOp } from "../../shared/projectnotes.ts";
import { itemOp } from "../../shared/items.ts";
import type { ItemOp } from "../../shared/items.ts";
import { derivesOn, existsIn } from "../../shared/noteplace.ts";
import { briefWhen } from "../../shared/titles.ts";
import { docTitle, fixedScope, focusFrom, linkRefused, PROJECT, PROJECT_SCOPE, titleOfScope, versionName, viewFocus } from "../../shared/views.ts";
import { BoardPanel } from "./boardpanel.ts";
import { BoardSync } from "./boardsync.ts";
import { GraphCanvas } from "./canvas.ts";
import type { Target, VisitorPoint } from "./canvas.ts";
import { ContextMenu, menuItems } from "./ctxmenu.ts";
import type { MenuContext, MenuTarget, TrustTo } from "./ctxmenu.ts";
import { ClusterPanel } from "./clusterpanel.ts";
import { dataSource } from "./data.ts";
import { WholeReview } from "./reviewread.ts";
import { LiveBuild } from "./buildread.ts";
import type { DataSource, ReviewState, ViewAnswer } from "./data.ts";
import { exactContext, judgedText } from "../../shared/context.ts";
import type { ModuleContexts } from "../../shared/context.ts";
import type { DeclarationText } from "../../shared/excerpt.ts";
import { Graph } from "../../shared/viewgraph.ts";
import { escapeHtml } from "./highlight.ts";
import { dragKeyName, dragMoves, isDragKey, lockedChoice, setLockedChoice } from "./drag.ts";
import { Notes } from "./notes.ts";
import { Stickies } from "./sticky.ts";
import type { Dropped, NoteKind } from "./sticky.ts";
import { notesOfFiles, ProjectNotes } from "./projectnotes.ts";
import { Outline } from "./outline.ts";
import { Panel } from "./panel.ts";
import { People, READ_ONLY, personKey } from "./people.ts";
import { Asking, askMark } from "./askfollow.ts";
import type { AskAnswered, AskFollow } from "../../shared/askfollow.ts";
import { PeerMenu } from "./peermenu.ts";
import { applyOwn, followedOf, presenceOf } from "./surfaces.ts";
import type { PageParts } from "./surfaces.ts";
import { Activity } from "./activity.ts";
import { LostAndFound } from "./lostfound.ts";
import { deployWaiting, popHtml, stamp, stepPill } from "./buildpop.ts";
import type { DeployStatus } from "../../shared/deploy.ts";
import { githubBlob } from "../../shared/deploy.ts";
import type { BuildLine } from "../../shared/lostfound.ts";
import { Editor } from "./editor.ts";
import { FocusMenu, keptFocus, readerFocus } from "./focus.ts";
import { Guide, restsOnCounts } from "./guide.ts";
import type { RestsOn } from "./guide.ts";
import { reducedMotion } from "./tipcards.ts";
import { kindDot, ringed } from "./axiomring.ts";
import { keepFocus } from "./keepfocus.ts";
import { Legend } from "./legend.ts";
import { applyTheme, holdTheme, themeChoices } from "./theme.ts";
import { besideSide, Popover } from "./popover.ts";
import { ReviewBox } from "./reviewbox.ts";
import { ReviewFlow } from "./reviewqueue.ts";
import { SearchBox } from "./search.ts";
import { SelectionBar } from "./selbar.ts";
import type { LitCount } from "./selbar.ts";
import { click, clusterIndex, clusterOn, clusterPick, clusterSet, declPick, edgeMode, enterStep, followRenames, keyTwo, pickWords, readSelection, remove, restsOn, retool, sameShown, selectionQuery, selectionText, shownOf, STEPS, TOOLS } from "./selection.ts";
import type { KeysOf, Pick, Root, Shown, Tool } from "./selection.ts";
import { SourceWindow, sourceMemory } from "./sourcewin.ts";
import type { SourceHooks } from "./sourcewin.ts";
import { routeKey, Sources } from "./sources.ts";
import { PAGE_VERSION, Reloader, takeKept } from "./reload.ts";
import type { Kept } from "./reload.ts";
import { pairTop } from "./paperdock.ts";
import { Papers } from "./paperlinks.ts";
import { clusterSubject, fileOf, linkOf, PAST_LINK } from "../../shared/library.ts";
import { camOf, goneNames, missingLine, readSnapshot, snapshotIn, sortOut, withSnapshot, writeSnapshot } from "../../shared/sharesnap.ts";
import { decodeRecipe, readRecipe, recipeIn, resolveRecipe } from "../../shared/artrecipe.ts";
import { uploadFile } from "./library.ts";
import { STATUS_LABEL, STATUSES, statusCodes, statusState } from "./status.ts";
import type { Scheme } from "./status.ts";
import { Tabs } from "./tabs.ts";
import { Share } from "./share.ts";
import { excerpt, ownAgents, PUBLIC, stateWords, Talk } from "./talk.ts";
import { ChatWindow, keepStripClear } from "./chatwin.ts";
import { chipOf, chipText, copyLink, noteHash, noteIn, siteLink, siteOrigins, withoutKeys } from "./chatlinks.ts";
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
import { clusterPrefix, SHIELD, Trust } from "./trust.ts";
import { decodeState, encodeState, tipsIn, tipsPart } from "./state.ts";
import type { ViewState } from "./state.ts";
import { Store } from "./store.ts";
import { typing } from "./typing.ts";
import { nameNow, setPeople, VERIFIED } from "./verified.ts";
import { ViewNav } from "./viewnav.ts";
import { readVisitors, shareVisitors, stillVisiting, visit, visitorEdges } from "./visitors.ts";
import type { Visitor } from "./visitors.ts";
import type { Place } from "./viewnav.ts";
import { Views } from "./views.ts";
import { LayoutQueue } from "./layoutqueue.ts";
import type { LayoutWorker } from "./layoutqueue.ts";
import type { Board } from "./views.ts";
import { buildWhen, TimeMachine } from "./timemachine.ts";
import type { TimeMachineAt } from "./timemachine.ts";
import { boardMarks, markWords, PAST_CHANGED, PAST_GHOST, PAST_RENAMED, reviewThen } from "./past.ts";
import type { PastGraph } from "./past.ts";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** The tools by name: the modes Selection and Used by, and the three steps of the mode Rests on
 *  (decided 2026-10-08, ViewSpec decision 20). */
const MODE_NAME: Record<Tool, string> = { plain: "Selection", deps: "Uses", tcb: "TCB", keys: "Keys", refs: "Direct", apps: "Used by" };
/** A tool as the others' list and the notes say it: a step with its mode. */
const toolName = (t: Tool): string => (restsOn(t) ? `Rests on · ${MODE_NAME[t]}` : MODE_NAME[t]);

/** What a click selects with each tool (the mode buttons, web/src/selection.ts): said while the
 *  pointer is on a button. */
const MODE_HINT: Record<Tool, string> = {
  plain: "A click selects just what you click; shift-click adds it or takes it out.",
  deps: "A click selects what you click and everything it uses, proofs included: the most it rests on.",
  refs: "A click selects what you click and what it uses directly: in its statement, its body or its proof.",
  tcb: "A click selects the TCB of what you click: the definitions its statement rests on, proofs skipped.",
  keys:
    "A click selects what you click and the key declarations in its TCB: where the review has a focus, that target's; elsewhere every target's, or a target's own when you click a target. " +
    "Dashed edges are the key graph: from A to B when A rests on B through declarations that are not key.",
  apps: "A click selects what you click and everything that uses it.",
};
/** What Rests on is, while the pointer is on its button: the question its steps answer, at the
 *  granularities everything used ⊇ the TCB ⊇ the key declarations in it, and one step: what it uses
 *  directly (ViewSpec decision 20). */
const RESTS_HINT = "A click selects what you click rests on, as much of it as the step says:";
const STEP_HINT: Record<Tool, string> = { plain: "", apps: "", deps: "everything it uses, proofs included", refs: "what it uses directly, proofs included", tcb: "what its statement rests on, proofs skipped", keys: "the key declarations in its TCB" };
/** What a tap selects with each tool, in a few words: under the tool's name in a phone's ⋯, where
 *  nothing is said while a pointer rests on a button (web/src/phone.ts). */
const TAP_HINT: Record<Tool, string> = { ...STEP_HINT, plain: "just what you tap", apps: "everything that uses it" };
/** What a link to a view the server no longer has opens instead, and why (ViewSpec decision 6). */
const VIEW_GONE = "This link's view is gone: it was deleted, or nobody kept it and everyone closed it. Here is the Project.";

interface GraphInfo {
  version: number;
  /** the server's process that counts the versions (UpdateSpec decision 8) */
  instance?: string;
  at: string;
  missing: string[];
  /** the usage pass on this graph's build (server/live.ts) */
  usage?: { state: "pending" | "done" | "off"; failed: number };
  /** following a branch (DeploySpec): the commit whose build the graph was read from */
  commit?: string;
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

const STATE_LABEL: Record<string, string> = {
  failed: "failed",
  unbuilt: "never built",
  blocked: "blocked",
  stale: "out of date",
  queued: "queued",
  building: "building",
  sorry: "uses sorry",
};

async function boot(): Promise<void> {
  const data = dataSource();
  const ready = await waitReady(data);
  let graphInfo = ready.graph;
  // the graph's two parts, the review and the build status, at once: a page far from the server
  // waits on each
  const reviewing = data.review().catch((): ReviewState => ({ epoch: "", rev: 0, data: emptyReview(), problems: [], error: "The review could not be loaded." }));
  /** the build status, read as the page loads (web/src/buildread.ts): shown once the first board is */
  let firstBuild = data.snapshot ? null : data.build();
  firstBuild?.catch(() => {});
  const [meta0, edges0] = await Promise.all([data.meta(graphInfo?.version, graphInfo?.instance), data.edges(graphInfo?.version, graphInfo?.instance)]);
  let meta: ViewMeta = meta0;
  /** the graph on show: the latest build's */
  let present = new Graph(meta, new Int32Array(edges0));
  /** the graph the board on show was taken from: the graph on show's, or a past build's */
  let g = present;
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
  // tips in place (GuideSpec decision 9; web/src/intip.ts): the moments the page tells of, before the
  // guide is made; and the release the server runs (UpdateSpec), as its event stream says it
  let offerTip = (_rule: string): void => {};
  let didTip = (_rule: string): void => {};
  let countTip = (_name: string, _rule: string): number => 0;
  let heardRelease: string | null = null;
  let hearRelease = (v: string): void => void (heardRelease = v);
  /** read-only links can be made on this server: the tip about them is for it alone */
  let readOnlyLinks = false;
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
  /** The project as read, for the About part of the help sheet: how much the graph holds, when it
   *  was read and under which toolchain (it was a line at the foot of the page until 2026-10-08). */
  const about = () =>
    `${meta.projectCount.toLocaleString()} declarations · ${(meta.nodes.length - meta.projectCount).toLocaleString()} outside the project · ` +
    `${meta.edgeCount.toLocaleString()} edges. Read ${new Date(meta.project.extractedAt).toLocaleString()}, under ${meta.project.toolchain}.`;

  /** the selection (web/src/selection.ts): its picks, by name and key, and what the panel tells of */
  let picks: Pick[] = [];
  let shown: Shown | null = null;
  /** the declaration the panel tells of, in the whole graph's numbering, or null */
  const selected = (): number | null => (shown && "decl" in shown ? g.byName.get(shown.decl) ?? null : null);
  /** the reader's visitors on the board on show (ViewSpec decision 27; web/src/visitors.ts), newest
   *  last, and the board they are on: another board has none */
  let visitors: Visitor[] = [];
  let visitorsOn = "";
  /** while something is said where the hint is (`say`), until it goes */
  let saying: ReturnType<typeof setTimeout> | null = null;
  let build: BuildStatus | null = null;
  /** the branch the server follows and builds itself (DeploySpec), as it last said; null for a
   *  workspace */
  let deploy: DeployStatus | null = null;
  let updating = false;
  let extractError: string | null = null;
  let offline = false;
  /** the version the server restarts into (`update`), until the page is back with it */
  let updatingTo: string | null = null;
  /** the version the page waits to reload into, while a reload would cut something short */
  let reloadOffered: string | null = null;
  /** the depth stepper's label (defined with the side panel below) */
  let showLevel = () => {};
  /** draw the edges, or not (defined with the eyes below) */
  let setEdges = (_edges: boolean): void => {};
  /** the review (ReviewSpec.md), as the server last told it: the whole once, then each change */
  let review: ReviewState = await reviewing;
  /** The review as the board on show reads it, by its declarations' names: on a past graph, what was
   *  said of a declaration renamed since — kept under its name now — is read under its name then too
   *  (web/src/past.ts, reviewThen), made once per revision of the review and past graph. */
  let readThen: { data: ReviewData; rev: number; past: PastGraph; out: ReviewData } | null = null;
  const boardReview = (): ReviewData => {
    const past = nav.board?.past?.past;
    if (!past || !past.nowName.size) return review.data;
    if (readThen?.data !== review.data || readThen.rev !== review.rev || readThen.past !== past) readThen = { data: review.data, rev: review.rev, past, out: reviewThen(review.data, past.nowName) };
    return readThen.out;
  };

  // ---------------------------------------------------------------- the views
  //
  // The view on show is a board (web/src/views.ts): the canvas shows its graph — the whole one, or
  // the part its scope holds — and the panel always speaks of the whole graph. `nav` keeps the tabs.

  // whether a layout's memory can be handed over now (web/src/views.ts): known once the people are
  let handsOver = (): boolean => false;
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
  const views = new Views(data.views, {
    ...(data.snapshot ? {} : { layOut: layOutBoard }),
    graph: () => present,
    handsOver: () => handsOver(),
    meta: () => meta,
    review: () => review.data,
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
  const projectNotes = new ProjectNotes(data.views, () => people?.stream ?? null);
  await projectNotes.load();
  const nav = new ViewNav(views, store, {
    show: (b, L) => showBoard(b, L),
    place: (p, fresh) => place(p, fresh),
    here: () => here(),
    // the address is written by the step that showed the view (one entry), or replaced after
    changed: () => {
      syncBusy();
      renderTabs();
      people.report();
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
    present: () => present,
    meta: () => meta,
    review: () => review.data,
    board: () => nav.board ?? null,
    title: (id) => views.title(id),
    tip: (id) => views.tip(id),
    redraw: () => nav.redraw(),
    memory: (id, mode) => data.views.memory(id, mode),
    changed: () => {
      people.report();
      syncPast();
    },
    go: (name) => goName(name),
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
    newBuild: (from, to) => void newBuild(from, to),
  });
  /** The board on show is of a past graph: a view kept at a past build, or the Time Machine's. It is
   *  a board as any other (the owner's decision of 2026-10-10), but for the review: a past build is
   *  not reviewed. Its document is that build's (ExportSpec decision 16). */
  const pastShown = (): boolean => !!nav.board?.past;
  /** Why the review is refused on a past board, where it would be given. */
  const PAST_REVIEW = "This board shows a past build: opinions, key marks, targets and trust are given on the latest build.";
  const READ_ONLY_REVIEW = "Read-only: the review as it stands, live.";
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
  // which modules' present text is not the text the graph was read from (its declarations' places,
  // statements and hashes are about the compiled one): found out from the served source's hash
  let compiled = new Map(meta.modules.map((m) => [m.name, m.compiled]));
  const edits = new Map<string, boolean>();
  // the lines of each file read with it (null where it could not be read): what an opinion
  // records, and what a stale one is compared with; and the usage pass's contexts of that text,
  // where it has them (shared/context.ts)
  const served = new Map<string, string[] | null>();
  const servedContexts = new Map<string, { contexts: ModuleContexts | null; hash: string | null }>();
  const editedNow = (i: number): boolean | null => (g.isExt(i) ? false : edits.get(g.nodes[i].module) ?? null);
  const edited = async (i: number): Promise<boolean> => {
    if (g.isExt(i)) return false;
    const mod = g.nodes[i].module;
    const known = edits.get(mod);
    if (known !== undefined) return known;
    const c = compiled.get(mod);
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
    const v = g.nodes[i];
    if (g.isExt(i) || !v.range) return null;
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

  // the review flow where the review has a focus (ViewSpec decision 28): the focus's review set in
  // review order, the next one to review, why a declaration is in it (web/src/reviewqueue.ts)
  const flow = new ReviewFlow({ graph: () => g, review: () => boardReview(), reader: () => people.name });
  /** The same on the graph on show, whatever build the board shows: how far each target's review has
   *  come is the review's now (the targets list, the views menu) */
  const flowNow = new ReviewFlow({ graph: () => present, review: () => review.data, reader: () => people.name });
  /** Why this reader's opinions are refused until their log is fixed by hand (a line of it cannot
   *  be read, server/review.ts), or null. */
  const blocked = (): string | null => {
    const me = people.name?.trim();
    if (!me) return null;
    // someone invited by a personal link writes to their link's log (CollabSpec decision 9)
    const mine = logFileName(me, false, people.person?.id ?? null);
    const p = review.problems.find((x) => x.file === mine);
    return p ? `Your review log (log/${mine}) has a line that cannot be read — line ${p.line}: ${p.why}. Nothing more is written to it until it is fixed by hand.` : null;
  };
  /** The reader's own focus on the board on show (ViewSpec decision 28; web/src/focus.ts): a target,
   *  none (null), or the view's own (undefined). It is theirs as the camera is: remembered per view
   *  (`here`, `place`) and followed (`whereIAm`). */
  let mine: string | null | undefined;
  const isTarget = (name: string): boolean => Object.hasOwn(boardReview().targets, name);
  /** The targets the board on show holds, by name. */
  const heldTargets = (): string[] =>
    Object.keys(boardReview().targets)
      .filter((n) => {
        const i = g.byName.get(n);
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
  const reviewName = (): string | null => (nav.board ? readerFocus(mine, viewFocusName(), isTarget, [...linkedTargets(), ...heldTargets()]) : null);
  /** The same in the whole graph's numbering. */
  const reviewRoot = () => {
    const t = reviewName();
    return t === null ? null : g.byName.get(t) ?? null;
  };
  /** Whose key declarations a Keys pick of `r` holds (ViewSpec decision 20) where the review's focus
   *  is `target` (by default the board on show's): that target's; elsewhere a target's own when the
   *  target itself is clicked — a click on a target selects it and its key declarations — and every
   *  target's for anything else. */
  const keysFor = (r: Root, target: string | null = reviewName()): KeysOf =>
    target ?? ("decl" in r && Object.hasOwn(boardReview().targets, r.decl) ? r.decl : null);
  /** A declaration clicked with the tool, on the board on show or (`target`) on another. */
  const pickDecl = (name: string, target?: string | null): Pick => declPick(S.mode, name, keysFor({ decl: name }, target));
  /** A cluster of the board clicked with the tool. */
  const pickCluster = (c: number): Pick => {
    const cl = canvas.layout.clusters[c];
    return clusterPick(S.mode, cl, cm(), keysFor({ cluster: cl.key, by: cm() }));
  };
  /** The Selection tool, nothing selected again (walking a TCB chooses it). */
  const toSelection = () => {
    if (S.mode === "plain") return;
    S.mode = "plain";
    store.save();
    syncTool();
  };
  /** Walking a target's TCB (a row of its review list, the strip's target): the declaration alone,
   *  under the Selection tool whatever the tool was (ViewSpec decision 15); Rests on or Used by then
   *  show it and the rest of the board. */
  const walk = (i: number) => {
    toSelection();
    go(i);
  };

  const reviewBox = new ReviewBox(g, {
    review: () => ({
      data: boardReview(),
      error: review.error,
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
              if (ok === true) commit();
              else if (typeof ok === "string") say(ok);
            });
          },
        }),
    go: (i) => go(i),
    openSource: (name, from, to, quoted, root) => openSourceAt(name, from, to, quoted, root),
  });
  if (kept) reviewBox.restoreDrafts(kept.review);
  /** What declaration `i` of the board's graph is called now: on a past graph, the name a rename
   *  since gave it, which the review, the views' records and their scopes speak (HistorySpec decision
   *  8); else its name. */
  const declNow = (i: number): string => nav.board?.past?.past.nowName.get(g.nodes[i].name) ?? g.nodes[i].name;
  /** The declarations clicked (the selection's picks' roots), in the whole graph's numbering. */
  const clickedDecls = (): number[] =>
    picks.flatMap((p) => {
      const j = p.root && "decl" in p.root ? g.byName.get(p.root.decl) : undefined;
      return j === undefined ? [] : [j];
    });
  /** What "Mark selected as key" would mark where the review has a focus (web/src/selbar.ts): the
   *  declarations clicked that the focus's TCB holds, trusted or not (ExportSpec decision 1), not key
   *  yet; null where there is no focus. */
  const keyMarking = () => {
    const r = reviewRoot();
    // a past build is not reviewed: the review box says so
    if (r === null || data.snapshot || pastShown() || reader) return null;
    const xs = clickedDecls().filter((j) => flow.keyable(r, j));
    const already = xs.filter((j) => flow.isKey(r, j)).length;
    return { target: g.short(r), fresh: xs.length - already, already, names: xs.filter((j) => !flow.isKey(r, j)).map((j) => g.nodes[j].name) };
  };
  /** Mark or unmark a declaration as key for the focus (k): the one in the panel, or in the source
   *  window the key was pressed in. */
  const toggleKey = (i = selected()) => {
    const r = reviewRoot();
    if (r === null || i === null || i === r || data.snapshot) return;
    if (reader) return say(READ_ONLY);
    if (pastShown()) return say(PAST_REVIEW);
    if (!flow.keyable(r, i)) return say(`${g.short(i)} is not in ${g.short(r)}'s TCB: only what it holds can be key for it.`);
    const target = g.nodes[r].name;
    void people.ensure().then((me) => {
      if (!me) return;
      void submit({ op: "key", target, name: g.nodes[i].name, on: !keyMarked(review.data, target, g.nodes[i].name) }).then((why) => why && say(why));
    });
  };

  /** What a query lights up on the board on show: computed on the whole graph the board was taken
   *  from, then cut to what the board holds (shared/board.ts, lightUp). */
  const litOn = (q: Query): Lit => lightUp(nav.board.full, boardReview(), nav.board.bs, q);
  /** Zoom in (ViewSpec decision 13): the scope of a view of what `q` lights up on this board, which
   *  holds exactly that; null when it would hold nothing, or just what this board holds. */
  const zoomOf = (q: Query | null, lit: Lit | null = q && litOn(q)): Query | null =>
    q && lit && zoomScope(q, nav.board.rec.scope, lit, nav.board.bs);

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
    graph: () => g,
    clustering: () => cm(),
    boardSubject: () => (shown && "decl" in shown ? `decl(${shown.decl})` : shown && "cluster" in shown ? clusterSubject(shown.cluster, cm()) : null),
    // a past build is not reviewed, and links are part of the review (ViewSpec decision 26)
    cannotLink: () => (data.snapshot ? "A snapshot of the page shows the links as they were: they are made on the server." : reader ? READ_ONLY : pastShown() ? PAST_LINK : null),
    goDecl: (name) => {
      const i = g.byName.get(name) ?? g.foldedInto.get(name);
      if (i === undefined) say(`${name} is not in the graph on show.`);
      else go(i);
    },
    goCluster: (kind, key) => {
      if ((kind === "file") !== (cm() === "module")) return say(`${key} is a cluster by ${kind === "file" ? "file" : "namespace"}: this board is clustered by ${cm() === "module" ? "file" : "namespace"}.`);
      const c = clusterIndex(canvas.layout, key);
      if (c < 0) say(`${key} is not a cluster of this board.`);
      else goCluster(c);
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
    cannotNote: () => noteRefused(),
    clip: (c, text) => clipToNote(c, text),
    attach: (note, c) => attachTo(note, c),
  });

  const panel = new Panel($("#panel"), g, reviewBox, {
    links: (i) => papers.declHtml(i),
    go: (i) => go(i),
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
      clear();
      commit();
    },
    // a past build's files are not the build status of now
    fileOf: (i) => (pastShown() ? undefined : fileIndex.get(g.nodes[i].module)),
    alsoHere: (i) => {
      const on = people.on(g.nodes[i].name);
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
    editorLink: (i) => editor.href(g, i),
    shut: (section) => store.isShut(section),
    toggle: (section) => store.toggleShut(section),
    then: (i) => thenHtml(i),
  });
  /** What the panel says of a declaration of a past graph (HistorySpec decision 17): the build it
   *  is shown at, whether its source then is kept (decision 23), and what became of it since. */
  const thenHtml = (i: number): string | null => {
    const past = nav.board?.past?.past;
    if (!past || g !== past.graph) return null;
    const s = past.snapshot;
    const m = past.marks[i] ?? 0;
    const kept = g.isExt(i) || !g.nodes[i].range ? null : past.kept.get(g.nodes[i].module);
    const then = g.isExt(i) || !g.nodes[i].range ? "its statement and doc then." : kept ? "its statement, doc and source then (Space)." : "its statement and doc then; its source then is not kept.";
    const now = past.nowName.get(g.nodes[i].name);
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
    goCluster: (c) => goCluster(c),
    go: (i) => go(i),
    preview: (i) => canvas.preview(i === null || toView(i) < 0 ? null : toView(i)),
    previewCluster: (c) => canvas.previewCluster(c),
    zoom: (c) => void zoomCluster(c),
    canZoom: (c) => !reader && clusterScope(c) !== null,
    hide: (c) => hideLevel(canvas.layout.clusters[c].key),
    trust: (c) => trust.state(canvas.layout.clusters[c], cm()),
    trustClicked: (c, anchor) => trust.clicked(canvas.layout.clusters[c], cm(), anchor),
    // a past build's files are not the build status of now, and its modules are its graph's
    fileOf: (m) => (pastShown() ? undefined : fileIndex.get(m)),
    stateLabel: (st) => STATE_LABEL[st],
    modulesUnder: (prefix) => g.meta.modules.filter((m) => m.name === prefix || m.name.startsWith(prefix + ".")).map((m) => m.name),
    goToModule: (m) => goToModule(m),
    close: () => {
      clear();
      commit();
    },
    links: (key, mode) => papers.clusterHtml(key, mode),
  });

  // the selection, under the mode buttons (web/src/selbar.ts)
  const selBar = new SelectionBar($("#selbar"), {
    canOpenViews: () => !reader,
    names: () => views.titles().names ?? undefined,
    show: (k) => {
      const to = shownOf(picks[k]);
      if (!to) return;
      shown = to;
      apply();
      revealShown();
      commit();
    },
    remove: (k) => {
      ({ picks, shown } = remove(picks, shown, k));
      apply();
      commit();
    },
    zoom: () => void zoomIn(),
    clear: () => {
      clear();
      commit();
    },
    markKeys: () => {
      const m = keyMarking();
      if (m) void reviewBox.markKeys(m.names).then((why) => why && say(why));
    },
  });

  // the source windows (ReviewSpec, "The source window"; web/src/sources.ts): the one that follows
  // the selection, opened in the middle of the screen each time, and those the reader pinned; a
  // reload starts without them
  const viewport = () => ({ w: document.documentElement.clientWidth || innerWidth, h: document.documentElement.clientHeight || innerHeight });
  /** whether the page's history has a step back and one forward: the following window shows it */
  let steps = { back: false, forward: false };
  // the source windows are of the graph on show (`useGraph`): on a board of a past build, they show
  // the text that build was compiled from (HistorySpec decision 23)
  const sourceHooks: SourceHooks = {
    go: (name) => {
      const j = g.byName.get(name);
      if (j !== undefined) go(j);
    },
    // a past build's files are not the build status of now
    fileOf: (m) => (pastShown() ? undefined : fileIndex.get(m)),
    compiledOf: (m) => compiled.get(m),
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
    steps: () => steps,
    editorLink: (G, i, at) => editor.href(G, i, at),
    // following a branch on GitHub (DeploySpec decision 13): the build's lines there
    githubLink: (file, commit, from, to) => (deploy?.github ? githubBlob(deploy.github, commit, file, from, to) : null),
    builtCommit: () => graphInfo?.commit ?? null,
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
    make: () => new SourceWindow($("#windows"), g, data, reviewBox, sourceHooks, memory),
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

  /** Open declaration `name`'s source at lines `from`–`to` of its file (a code quote's header in a
   *  comment, clicked in `at`; ReviewSpec, "Comments"): in a window that shows it already — the one
   *  clicked in, else any — and else in the following window, the declaration gone to first; the
   *  lines are scrolled to and flashed there. */
  const openSourceAt = (name: string, from: number, to: number, quoted: string[] | null, at: HTMLElement | null) => {
    const j = g.byName.get(name) ?? g.foldedInto.get(name);
    if (j === undefined) return say(`${name} is not in the graph now.`);
    const here = at ? sources.at(at) : null;
    let w = here?.decl === j ? here : sources.all.find((p) => p.decl === j) ?? null;
    if (w) sources.reveal(w);
    else {
      if (selected() !== j) go(j);
      w = sources.show(j);
    }
    w.showLines(from, to, quoted);
  };

  /** The cluster the panel tells of, in the board's layout (its key read in the board's
   *  clustering); -1 when it tells of none, or of one this board does not hold. */
  const shownCluster = (): number => (shown && "cluster" in shown && canvas.layout ? clusterIndex(canvas.layout, shown.cluster) : -1);

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
    const k = i === null ? -1 : visitorOf(i);
    canvas.setLead(i !== null && toView(i) >= 0 ? { kind: "node", i: toView(i) } : k >= 0 ? { kind: "visitor", k } : null, leadEnd);
    // an opinion given on an earlier version, its What changed closed (web/src/tips.ts, stale-opinion)
    if ($("#panel details[data-rv-changes]:not([open])")) offerTip("stale-opinion");
    if (i !== null && editedNow(i) === null && !pastShown())
      void edited(i).then((e) => {
        if ((e || reviewBox.needsSource(i)) && selected() === i && !pastShown()) {
          panel.show(i);
          sources.follow(i);
        }
      });
  };

  // the first view: the one the address names, else the tab the reader left on show, else the
  // Project
  const linked = decodeState(location.hash);
  /** a link to the help's film (`#tips`, `#tips=<chapter>`: web/src/state.ts), opened once the page
   *  is there; and the part of the address that says the film shows, while it does */
  const filmLink = tipsIn(location.hash);
  let filmPart = "";
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
  const canvas = new GraphCanvas($("#canvas") as HTMLCanvasElement, $("#labels") as HTMLCanvasElement, $("#cards"), g, {
    covers: overlays,
    // a click with the tool (web/src/selection.ts); a double-click on a cluster folds or opens it,
    // which the canvas does itself
    nodeClick: (j, shift) => void clickOn(pickDecl(vg().nodes[j].name), shift),
    // a visitor is a declaration as any: clicked with the tool (ViewSpec decision 27)
    visitorClick: (k, shift) => {
      if (visitors[k]) clickOn(pickDecl(visitors[k].name), shift);
    },
    clusterClick: (c, shift) => void clickOn(pickCluster(c), shift),
    backgroundClick: () => {
      clear();
      commit();
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
        const vis = visitors[t.k];
        const i = vis ? g.byName.get(vis.name) : undefined;
        if (!vis || i === undefined) return void (tip.hidden = true);
        const dot = kindDot(g.nodes[i].kind, g.isExt(i));
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
          ` <span class="tip-st">${cl.count.toLocaleString()} · ${what}${dragging() ? " · drag to move" : ""}</span>`;
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
      showLevel();
    },
    menu: (t, x, y, world) => openMenu(t, x, y, world),
    frozenDrag: () => say(frozenWhy()),
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
    notes: () => ({ project: asOpenHere(projectNotes.list), view: asOpenHere(nav.board?.rec.notes ?? []) }),
    // the Project holds every note of the project; another board what its scope gives and its
    // view's lists (the owner's decision of 2026-10-11), the links read as the board reads the review
    items: () => ({ all: !nav.board || fixedScope(nav.board.rec), items: nav.board?.rec.items, links: boardReview().links ?? [] }),
    board: () => (nav.board ? { nodes: vg().nodes, full: nav.board.full.nodes, mode: cm(), nowName: nav.board.past?.past.nowName } : null),
    // a note attached to a declaration shows at the reader's visitor of it, and falls back under the
    // other clustering to beside it in the Project's layout of that clustering
    visitors: () => visitors.map((v) => v.name),
    whole: (m) => ({ L: meta.layouts[m], index: present.byName }),
    resolve: (name) => (g.byName.has(name) ? name : null),
    go: (name) => {
      const i = g.byName.get(name);
      if (i !== undefined) go(i);
    },
    moves: (h) => !frozen() && dragMoves(locked, h),
    setOpen: (id, _kind, open) => setNoteOpen(id, open),
    moved: (id, to) => void moveNote(id, to),
    // where a card hangs from its icon is shared as its state is, and is no edit
    card: (id, kind, card) => void (kind === "project" ? projectOps([{ op: "pnote-card", id, card }]) : noteOps([{ op: "note-card", id, card }])),
    edit: (id) => void editNote(id),
    menu: (id, x, y) => openNoteMenu(id, x, y),
    unfold: (c) => canvas.toggleFold(c),
    // the library is the server's now, whatever build the board shows
    file: (sha) => fileOf(review.data, sha),
    noFiles: () => !!data.snapshot,
    openCarry: (_id, c) => papers.openCarry(c),
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
    selectDecl: (i, shift) => void clickOn(pickDecl(vg().nodes[i].name), shift),
    selectSection: (c, shift) => void clickOn(pickCluster(c), shift),
    frozen: () => (frozen() ? frozenWhy() : null),
    edges: () => S.showEdges,
    moveNote: (id, key, world, detach) => stickies.moveInto(id, key, world, detach),
    noteText: (id) => noteOf(id)?.note.text ?? null,
    noteOpen: (id) => noteOpenHere(id),
    toggleNote: (id) => setNoteOpen(id, !noteOpenHere(id)),
    // the board's menu on what a row is; Fold and Fit are the form's (menuAct)
    menu: (on, x, y, spot) => {
      if (on?.kind === "note") openNoteMenu(on.id, x, y);
      else openMenu(on?.kind === "decl" ? { kind: "node", i: on.i } : on ? { kind: "cluster", c: on.c } : null, x, y, spot ?? canvas.toWorld(x, y), false, on?.kind === "cluster" ? on.folded : undefined);
      if (menuOn) menuOn.linear = true;
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
  linearBtn.addEventListener("click", () => linear.toggle());

  /** In the artwork mode (ExportSpec decision 19, the owner's decision of 2026-10-15): of the bar,
   *  what is out of reach — all but Share and Search; and the keys that still act. */
  const ART_INERT = "#bar .brand, #bar .library-wrap, #export-btn, #activity-btn, #bar .talk-wrap, #bar .peers-wrap, #bar .who-wrap, #help-btn, #bar .more-wrap";
  const ART_KEYS = new Set(["/", "1", "2", "3", "f", "+", "=", "-", "_", "e", "[", "]", "l"]);
  // the board as a picture (ExportSpec decision 19, web/src/artframe.ts): the board itself, drawn
  // with the artwork's settings (`artLook`, drawLook below), a frame over it saying what is saved
  /** the artwork's settings the board is drawn with: null where its mode is off */
  let artLook: ArtSettings | null = null;
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
      const coming = !artLook && !!s;
      artLook = s && { ...s };
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
      Object.keys(review.data.targets)
        .map((name) => ({ name, label: name.split(".").pop() ?? name }))
        .sort((a, b) => a.label.localeCompare(b.label) || a.name.localeCompare(b.name)),
    // the title where the reader gave none: the project's name, its declarations and its targets
    titles: () => titleOf(meta.project.name, meta.projectCount, Object.keys(review.data.targets).length),
    say: (text) => say(text),
  });
  // the board's names are written in an artwork's fonts once they are there
  document.fonts?.addEventListener?.("loadingdone", () => {
    if (!artLook) return;
    canvas.invalidate();
    canvas.request();
  });
  /** The board drawn with the artwork's settings while its mode is on, or as the reader's own again
   *  (ExportSpec decision 19): the colouring and the theme, the background, the notes, the edges, the
   *  names, the targets and the selection; the panels put away for the frame. The reader's own
   *  choices are kept as they are, under it. */
  const drawLook = () => {
    const a = artLook;
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
    syncEdges();
    apply();
  };
  /** Of the bar in the artwork mode, Share and Search alone (the owner's decision of 2026-10-15): the
   *  rest is out of reach until the mode is left, by the pointer and by the keyboard — but the people
   *  while the reader follows someone, whose initials clicked again end following (CollabSpec,
   *  "Following ends" and "What following leaves"): the mode is the follower's own once it has. */
  const artReach = () => {
    for (const el of document.querySelectorAll<HTMLElement>(ART_INERT)) el.inert = !!artLook && !(people.following && el.matches(".peers-wrap"));
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
    review: () => ({ data: review.data, blocked: blocked(), readOnly: !!data.snapshot || pastShown() || !!reader, ...(pastShown() ? { note: PAST_REVIEW } : reader ? { note: READ_ONLY_REVIEW } : {}) }),
    graph: () => g,
    // each target counts what its review holds under the trust asked about (shared/reviewqueue.ts)
    targets: () =>
      Object.keys(review.data.targets)
        .map((name) => ({ name, i: g.byName.get(name) }))
        .filter((t): t is { name: string; i: number } => t.i !== undefined)
        .map((t) => ({ name: t.name, count: (d) => reviewCount(g, d, t.i) })),
    ensureReviewer: () => people.ensure(),
    submit,
    show: (p) => goToPrefix(p),
  });

  // The side panel holds the targets and the cluster tree; over the tree, two buttons open the rest
  // beside it (decided 2026-10-08, the page made simpler): the board's settings (⚙ Board: its scope,
  // clustering, depth, Re-layout) and what is trusted (Trusted, with how many prefixes).
  const boardPop = new Popover($("#board-btn"), $("#board-pop"), {
    place: () => besideSide($("#board-btn"), $("#board-pop")),
    changed: (open) => (open ? boardPanel.render() : boardPanel.reset()),
  });
  const trustPop = new Popover($("#trusted-btn"), $("#trust-list"), {
    place: () => besideSide($("#trusted-btn"), $("#trust-list")),
    // the question it asks, and the name that question may ask for, are part of it
    keep: "#trust-pop, #modal",
    changed: (open) => open && trust.render(),
  });
  /** The Trusted button: a shield, and how many prefixes are trusted. */
  const renderTrusted = () => {
    const n = review.data.trusted.length;
    $("#trusted-btn").innerHTML = `<span class="tl-shield">${SHIELD}</span>Trusted <span class="side-n">${n}</span>`;
    if (trustPop.open) trust.render();
  };

  const files = () => new Map((build?.files ?? []).map((f) => [f.module, f]));
  const outline = new Outline($("#outline"), {
    // a row is its cluster: clicked with the tool, and gone to
    select: (c, shift) => {
      if (clickOn(pickCluster(c), shift) && shownCluster() === c) canvas.flyToCluster(c);
    },
    picked: (c) => picks.some((p) => !!p.root && clusterOn(p.root, canvas.layout, cm()) === c),
    toggleFold: (c) => canvas.toggleFold(c),
    isFolded: (c) => canvas.folded.has(c),
    isCollapsed: (c) => canvas.isCollapsed(c),
    stateOf: (c) => {
      if (pastShown()) return "";
      const f = fileIndex.get(canvas.layout.clusters[c].key);
      return f && STATE_LABEL[f.state] ? `st-${f.state}` : "";
    },
    trustCell: (c) => trust.cell(canvas.layout.clusters[c], cm()),
    trustClicked: (c, row) => trust.clicked(canvas.layout.clusters[c], cm(), row),
    hide: (c) => hideLevel(canvas.layout.clusters[c].key),
  });
  let fileIndex = files();

  // the board's settings, in the ⚙ Board popover: its scope as chips (web/src/boardpanel.ts)
  const boardPanel: BoardPanel = new BoardPanel($("#board"), $("#board-note"), {
    view: () => {
      const b = nav.board;
      if (!b) return null;
      let own = 0;
      for (let i = 0; i < g.projectCount; i++) own += b.bs.set[i];
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
    levelChanged: () => showLevel(),
    activityChanged: () => activity.changed(),
    hint: (text) => say(text),
    writeAddress: (push) => writeAddress(push),
    // a preview of the view at another build is arranged by nobody here (web/src/views.ts); a view
    // kept at a past build is arranged as any (the owner's decision of 2026-10-10)
    frozen: () => (frozen() ? frozenWhy() : null),
    // the view's own focus, or its link, changed: the review follows where the focus in force did
    focusChanged: () => {
      const was = focusWas;
      syncFocus();
      if (focusWas !== was) apply();
    },
    // a target linked elsewhere, or its view deleted: its panel says so
    linksChanged: () => showSelected(),
  });

  /** Hide a level of the board on show by its cluster's key, for everyone on it (ViewSpec decision
   *  24): the outline's rows, a cluster's panel and the canvas's menu call it. */
  const hideLevel = (key: string) => void sync.hideLevel(key);
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

  /** The review strip, wherever the review has a focus (ReviewSpec, "Reviewing a target"; ViewSpec
   *  decision 28): it stays while the reader goes from one declaration to the next. */
  const renderStrip = () => {
    const r = reviewRoot();
    const bar = $("#lensbar");
    bar.hidden = r === null;
    if (r !== null) flow.renderStrip(r);
  };
  /** The focus in force, as last drawn by: what follows it (the key declarations' diamonds, the
   *  colour scheme) is made again when it changes. */
  let focusWas: string | null | undefined;
  /** The focus may have changed (the reader's choice, the view's, the targets, the board's set): what
   *  depends on it follows, and the header says it. */
  const syncFocus = () => {
    const f = reviewName();
    if (f !== focusWas) {
      focusWas = f;
      syncStatus();
      applyScheme();
    }
    focusMenu.render();
  };

  /** The review and the build on the canvas: the targets' stars, and where each declaration of
   *  the board stands (web/src/status.ts) — its colour in the Status scheme, the clusters' progress
   *  and the legend's counts. What agents advise is not among it: it stays in the panel. */
  const syncStatus = () => {
    const G = vg();
    // a past build's status is its review against now's opinions; its files' builds are not known
    canvas.setStatus(statusCodes(boardReview(), G, pastShown() ? new Map() : fileIndex));
    canvas.setTargets(Object.keys(review.data.targets).map((n) => G.byName.get(n)).filter((j): j is number => j !== undefined));
    // key declarations carry a diamond: where the review has a focus its target's, elsewhere every
    // target's (ExportSpec decision 4); each with the targets it is key for, so that an artwork whose
    // targets are chosen draws their keys alone (decision 19)
    const r = reviewRoot();
    const roots = r !== null ? [r] : Object.keys(review.data.targets).map((n) => g.byName.get(n)).filter((j): j is number => j !== undefined);
    const keys = new Map<number, number[]>();
    for (const t of roots) for (const k of flow.keys(t).keys) if (k !== t) keys.set(k, [...(keys.get(k) ?? []), t]);
    const onBoard = (k: number) => G.byName.get(g.nodes[k].name);
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
  const applyScheme = () => {
    canvas.setScheme(artLook?.scheme ?? ownScheme());
    legend.render();
  };
  const chooseScheme = (s: Scheme) => {
    store.setScheme(onReview(), s);
    applyScheme();
    people.report();
  };
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

  // ---------------------------------------------------------------- who is here
  //
  // The reader's name (CollabSpec decision 3) at the top right, and the others on the server
  // (decision 4): their initials beside it, their selections on the canvas and in the panel, and
  // following one of them — to their view, opened in a tab if need be (ViewSpec decision 10).

  const short = (name: string) => name.split(".").pop() ?? name;
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
      selection: () => ({ selection: selectionText(picks) }),
      // the reader's own focus, where they chose one (ViewSpec decision 28), and their visitors
      // (decision 27)
      focus: () => (mine !== undefined ? { focus: mine } : {}),
      visitors: () => (visitors.length ? { visitors: shareVisitors(visitors, (k) => canvas.visitorPos(k)) } : {}),
      panel: () => ({ sel: shown && "decl" in shown ? shown.decl : null }),
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
      edges: (v) => setEdges(v.edges!),
      linear: (v) => (v.linear ? void linear.show("followed") : linear.hide("reader", "followed")),
      artwork: (v) => art.follow(v.artwork ?? null),
    },
  };
  /** Where this page is: what the others are told, and what Share tells an agent. */
  const whereIAm = (): PresenceView => presenceOf(parts.read, nav.tabs.map((t) => t.id));
  /** The declaration a name in an agent's message stands for: a full name, or the one declaration
   *  whose name ends with it; null where there is none, or several. */
  const resolveName = (name: string): string | null => {
    if (!/^[\p{L}\p{N}_'!?.«»₀-₉]+$/u.test(name)) return null;
    if (g.byName.has(name)) return name;
    const tail = "." + name;
    let found: string | null = null;
    for (const n of g.nodes)
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
      const i = g.byName.get(name);
      if (i !== undefined) go(i);
    },
    open: (hash) => {
      people.unfollow();
      openAddress(hash);
    },
    chip: (url) => chipFor(url),
    seenLink: async () => copyLink({ origin: site.base, pathname: location.pathname }, await seenHash()),
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
    if (id === nav.board.id) place(to, false);
    else if (!(id && (await nav.select(id, to))) && scope) await nav.open(scope, to);
    const reached = nav.board.id === id || (scope !== null && nav.query() === scope);
    if (once && !reached) place(to, false);
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
    writeAddress(false);
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
          const i = g.byName.get(w.decl);
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
    const { view, gone } = sortOut(shot.view, { build: (id) => tm.snaps.some((s) => s.id === id), file: (sha) => !!fileOf(review.data, sha), link: (id) => !!linkOf(review.data, id) });
    const v: PresenceView = { mode: S.mode, sel: null, source: false, clusterMode: cm(), cam: null, view: nav.board.id, scope: null, tabs: [], ...view };
    // a view nobody keeps was opened by the address's query, at the build it carries: the snapshot's
    // id for it may be gone, its query is the same
    if (v.scope && nav.query() === v.scope) v.view = nav.board.id;
    gone.view = !(await goWhere(v, true));
    // what the board's graph (a past build's, in the Time Machine) does not hold, and a focus on what
    // is no target now
    const picked = readSelection(v.selection).flatMap((p) => (p.root && "decl" in p.root ? [p.root.decl] : []));
    Object.assign(gone, goneNames(v, picked, { decl: (n) => g.byName.has(n), target: (n) => Object.hasOwn(review.data.targets, n) }));
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
        const i = g.byName.get(name);
        const j = i === undefined ? -1 : toView(i);
        return j < 0 ? undefined : L.cluster[j];
      },
      targets: Object.keys(review.data.targets),
      projectCount: g.projectCount,
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
  // a layout's memory is handed over under a name, or by a private reader, as the server takes it
  handsOver = () => !reader && (!!data.snapshot || !!people.name || !!data.privateSession);
  /** The others' selections on the canvas, and who else is on the declaration in the panel. */
  const syncPeers = () => {
    const marks: { i: number; color: string; label: string }[] = [];
    for (const p of people.people()) {
      const seen = new Set<number>();
      for (const s of p.sessions) {
        const i = s.view?.sel ? g.byName.get(s.view.sel) : undefined;
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
    if (await nav.show(r.view.id, null)) commit();
    sync.afterPost();
    return null;
  };
  // a private reader's view is made without their name, and needs none (CollabSpec decision 8)
  const named = async (): Promise<string | null> => (reader ? READ_ONLY : data.snapshot || (await people.ensureLayout()) ? null : "A view is made under your name: give one first.");
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
    close: (id) => void nav.close(id).then(() => writeAddress(false)),
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
      writeAddress(false);
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

  // the review's focus on the board on show, in the view's header (ViewSpec decision 28;
  // web/src/focus.ts): the view's own, everyone's, or the reader's, theirs as the camera is
  const focusMenu = new FocusMenu($("#focus-btn"), $("#focus-menu"), {
    state: () => (nav.board ? { view: viewFocusName(), mine, focus: reviewName(), linked: linkedTargets(), held: heldTargets() } : null),
    short: (name) => views.titles().names?.decl(name) ?? short(name),
    choose: (f) => {
      mine = f;
      apply();
      writeAddress(false);
    },
    setView: async (f) => {
      if (frozen()) return frozenWhy();
      const why = await named();
      if (why) return why.replace("A view is made", "The view's focus is set");
      const r = await sync.change("focus", { focus: f });
      if (r.error) return r.error;
      nav.board.rec.focus = f;
      // the reader's focus is the view's now: nothing of their own is left
      mine = undefined;
      apply();
      writeAddress(false);
      return null;
    },
    canSet: () => !frozen(),
  });

  // the targets at the top of the side panel, each opening its view (web/src/targetlist.ts)
  const targetList = new TargetList($("#targets"), {
    readOnly: () => !!data.snapshot || !!reader,
    list: () => views.summaries,
    targets: () => Object.keys(review.data.targets),
    active: () => nav.board?.id ?? null,
    progress: (t) => {
      const i = present.byName.get(t);
      return i === undefined ? null : flowNow.progress(i);
    },
    keyProgress: (t) => {
      const i = present.byName.get(t);
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
    if (await nav.select(id)) commit();
  };
  /** A target, from the targets list: its view, on the target, or, with none (`id` null), a view
   *  nobody keeps of its TCB, linked to it (see reviewTarget); a target no longer in the graph opens
   *  its view alone, and with none has nowhere to go. */
  const openTarget = (id: string | null, target: string) => {
    if (id !== null && id !== nav.board.id && noSwitch()) return;
    const i = g.byName.get(target);
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
  const tcbOfTarget = (name: string) => {
    if (!targetTcbs.has(name)) {
      const i = present.byName.get(name);
      if (i === undefined) targetTcbs.set(name, null);
      else {
        const seen = present.reach([i], SITE_STMT | SITE_BODY, "out");
        const names = new Set<string>(), modules = new Set<string>();
        for (let j = 0; j < seen.length; j++)
          if (seen[j]) {
            names.add(present.nodes[j].name);
            if (!present.isExt(j)) modules.add(present.nodes[j].module);
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
      if (view !== nav.board.id) commit();
      if (stickies.has(id)) stickies.flyTo(id);
      else say("That note is no longer on this view.");
    });
  };

  const activity = new Activity($("#activity"), $("#activity-btn"), $("#activity-badge"), store, {
    me: () => people.name,
    review: () => review.data,
    mine: (name) => {
      // the targets this reader marked, or the reader they took it from by following them: not
      // those an agent of the same name marked
      const targets = new Set(Object.entries(review.data.targets).filter(([, t]) => name !== null && t.by === name && !t.agent).map(([n]) => n));
      const names = new Set<string>(), modules = new Set<string>();
      for (const t of targets) {
        const s = tcbOfTarget(t);
        s?.names.forEach((n) => names.add(n));
        s?.modules.forEach((m) => modules.add(m));
      }
      return { targets, names, modules };
    },
    touching: (mods) => Object.keys(review.data.targets).filter((t) => mods.some((m) => tcbOfTarget(t)?.modules.has(m))),
    covering: (p) =>
      Object.keys(review.data.targets).filter((t) => {
        for (const n of tcbOfTarget(t)?.names ?? []) {
          const i = present.byName.get(n)!;
          if (covers(p, n, present.nodes[i].module, present.isExt(i))) return true;
        }
        return false;
      }),
    showPrefix: (p) => goToPrefix(p),
    has: (name) => g.byName.has(name),
    go: (name) => {
      const i = g.byName.get(name);
      if (i !== undefined) go(i);
    },
    comment: (text, name) => reviewBox.comment(text, name),
    openOpinion: (r) => reviewBox.jump(r, null, null),
    openSource: (r, quoted) => openSourceAt(r.name, r.from, r.to, quoted, null),
    reviewTarget: (name) => {
      const i = g.byName.get(name);
      if (i !== undefined) reviewTarget(i);
    },
    goToModule: (m) => goToModule(m),
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

  // ---------------------------------------------------------------- the lost-and-found

  // what was said of declarations the graph no longer has (HistorySpec decisions 12–14), in a drawer
  // where Activity's is, opened from the build-status popover
  const lostDrawer = new LostAndFound($("#lostfound"), data.lost, {
    has: (name) => g.byName.has(name),
    go: (name) => {
      const i = g.byName.get(name);
      if (i !== undefined) go(i);
    },
    hasView: (id) => !!views.summary(id),
    openView: (id) => void openView(id),
    hasNote: (view, id) => hasNote(view, id),
    showNote: (view, id) => showNote(view, id),
    comment: (text, name) => reviewBox.comment(text, name),
    // Attach to…: a declaration of the graph, picked with the search, by its name now (a board of a
    // past build searches its own graph)
    pick: (prompt) => searchBox.pick(prompt).then((i) => (i === null ? null : declNow(i))),
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
      if (!pop.hidden) renderPop();
    },
  });

  // ---------------------------------------------------------------- into the Time Machine

  /** Open the Time Machine at a build (`snapshot`; the latest where left out), on a declaration
   *  (`name`): the build-status popover's Time Machine and recent builds, and the lost-and-found's
   *  Show in history, all come here. */
  const timeMachine = (at?: TimeMachineAt): void => void openTimeMachine(at);

  /** The review changed, once per change whoever made it (this reader, someone else, the logs on disk):
   *  everything that shows it follows. A board whose scope reads the review (trusted, statuses,
   *  advice) may hold another set now: the board on show is drawn again at once. */
  /** What the reader selected follows a rename of it (web/src/selection.ts, followRenames): a build
   *  that renamed it, or a move that says so, which may come before or after the new graph. True
   *  where it did; the board is drawn again by the caller. */
  const followSelection = (): boolean => {
    // the renames in force, and those the builds read since the page opened found of declarations
    // nothing was said of, which are in the history alone (HistorySpec decision 10)
    const renamed: Record<string, string> = Object.assign(Object.create(null), review.data.renamed);
    for (const [from, to] of buildRenames) if (!Object.hasOwn(renamed, to)) renamed[to] = from;
    const r = followRenames(picks, shown, renamed, (name) => present.byName.has(name));
    if (r.picks === picks && r.shown === shown) return false;
    ({ picks, shown } = r);
    return true;
  };
  /** The renames the history found from each build to the next one read while the page is open,
   *  old name → new (GET /api/history/diff): what the selection follows besides the renames in force */
  const buildRenames = new Map<string, string>();
  /** A new build was read (the Time Machine read the list again, web/src/timemachine.ts): its renames
   *  are asked for, and the selection follows them, whether the new graph is on show yet or not. */
  const newBuild = async (from: number, to: number) => {
    try {
      const r = await fetch(`/api/history/diff?from=${from}&to=${to}&most=20000`);
      const d = r.ok ? ((await r.json()) as { renamed?: unknown }) : null;
      if (!Array.isArray(d?.renamed)) return;
      for (const p of d.renamed) if (Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "string") buildRenames.set(p[0], p[1]);
    } catch {
      return;
    }
    if (!followSelection()) return;
    apply();
    selectionFollowed();
  };
  /** Where a selection that followed a rename is told: the address, and those following. */
  const selectionFollowed = () => {
    writeAddress(false);
    people.report();
  };
  const reviewChanged = () => {
    const followed = followSelection();
    targetTcbs.clear();
    views.reviewChanged();
    if (views.board(nav.board.id) !== nav.board) void nav.redraw().then(() => boardPanel.render());
    syncStatus();
    trust.reviewChanged();
    renderTrusted();
    // what is lit reads the review when a pick does (key declarations, trust, statuses), and the
    // key graph's edges under Keys always: lit again; else what shows the review is drawn again
    const q = selectionQuery(picks);
    if (followed || S.mode === "keys" || (q && readsReview(q))) apply();
    else {
      outline.render();
      // a visitor's colour by status, and its diamond, are the review's too
      drawVisitors();
      renderStrip();
      showSelected();
      renderSelBar();
    }
    activity.changed();
    boardPanel.render();
    renderTabs();
    papers.refresh();
    // what notes carry is drawn from the library's records, which are the review's
    stickies.render();
    if (followed) selectionFollowed();
  };
  /** The whole review (where this page holds another revision than the server's, or events came in
   *  between): taken unless this page holds that revision already. */
  const takeWhole = (st: ReviewState) => {
    if (st.epoch === review.epoch && st.rev <= review.rev) return;
    review = st;
    reviewChanged();
  };
  /** The whole review read again (GET /api/review, which a page holding it is answered 304): where
   *  the event stream says the server holds another revision, and where a change cannot be applied;
   *  one reading out at a time (web/src/reviewread.ts). */
  const wholeReview = new WholeReview(data.review, takeWhole, () => review);
  /** A change of the review (shared/review.ts, ReviewChange): its events applied to the review this
   *  page holds when it is the one they follow; once only, whether it came as the answer to this
   *  page's request or as the event every page gets. Anything else — a change missed, another run
   *  of the server — has the whole review read again. An event of a kind no longer recorded is
   *  skipped, as the server's replay skips it (the server sends none). */
  const takeChange = (c: ReviewChange) => {
    if (c.epoch === review.epoch && c.rev <= review.rev) return;
    // each event read as its log was: an agent's marked as one, an invited person's with their id
    const read = (e: unknown) => {
      const o = e as { agent?: unknown; person?: unknown };
      return readEvent(e, o.agent === true, validPersonId(o.person) ? o.person : null);
    };
    const events = c.epoch === review.epoch && c.base === review.rev && c.events ? c.events.map(read).filter((e) => e !== null) : null;
    if (!events || events.some((e) => typeof e === "string")) {
      void wholeReview.fetch();
      return;
    }
    // a replay that changed nothing (a new graph's reading, server/review.ts): the revision moves on
    const same = !events.length && JSON.stringify(c.problems) === JSON.stringify(review.problems);
    for (const e of events as ReviewEvent[]) applyEvent(review.data, e);
    review = { ...review, rev: c.rev, problems: c.problems, error: problemsText(c.problems) };
    if (!same) reviewChanged();
  };

  /** How many are lit on the board as the selection bar counts them: what is not trusted, the
   *  trusted apart (TCBSpec decision 7, ViewSpec decision 14). */
  const litCount = (lit: Lit | null): LitCount => (lit ? trustSplit(vg(), boardReview(), lit.set) : { counted: 0, trusted: 0 });
  /** The selection bar: its picks, what is lit, Zoom in, and where the review has a focus what "Mark
   *  selected as key" would mark — which the review changes, so it is drawn again with it. */
  const renderSelBar = (q = selectionQuery(picks), lit: Lit | null = q && litOn(q)) =>
    selBar.render(picks, picks.findIndex((p) => !!shown && sameShown(shownOf(p), shown)), litCount(lit), zoomOf(q, lit) !== null, keyMarking());

  /** What is selected, lit and shown: the selection's query evaluated on the whole graph and cut to
   *  the board (decided 2026-10-07: what is lit is exactly that set; the owner's decision,
   *  2026-10-08: on the whole graph, so that a path through what the board leaves out counts), the
   *  rings on its picks' roots, the panel, the selection bar. */
  const apply = () => {
    const G = vg();
    syncFocus();
    const q = selectionQuery(picks);
    const lit = q && litOn(q);
    // under Keys, the key graph's edges among what is lit instead of the references among it
    const keyEdges = S.mode === "keys" && lit && lit.count ? keyEdgesOn(lit) : null;
    // the picks' roots, on this board: declarations, and clusters of its clustering
    const decls: number[] = [], clusters: number[] = [];
    for (const p of picks) {
      if (!p.root) continue;
      if ("decl" in p.root) {
        const j = G.byName.get(p.root.decl);
        if (j !== undefined) decls.push(j);
      } else {
        const c = clusterOn(p.root, canvas.layout, cm());
        if (c >= 0) clusters.push(c);
      }
    }
    // an artwork's look (ExportSpec decision 19): its targets alone, the rest faded; or nothing of the
    // selection, which stays the reader's
    if (artLook?.targets === "highlight") {
      const alone = new Uint8Array(G.n);
      for (let i = 0; i < G.n; i++) if (canvas.isTarget(i)) alone[i] = 1;
      canvas.setActivation(edgeMode(picks), [], alone, [], null);
    } else if (artLook && !artLook.selection) canvas.setActivation(edgeMode(picks), [], null, [], null);
    else canvas.setActivation(edgeMode(picks), decls, lit?.set ?? null, clusters, keyEdges);
    linear.request();
    drawVisitors();
    renderSelBar(q, lit);
    syncTool();
    showSelected();
    outline.render();
    renderStrip();
    syncInsets();
  };

  /** The key graph's edges among what is lit (shared/keys.ts, litKeyEdges), as pairs in the board's
   *  numbering: where the review has a focus its target's key graph, elsewhere every target's — the
   *  union over the targets whose key declarations are lit. */
  const keyEdgesOn = (lit: Lit): number[] => {
    const r = reviewRoot();
    const roots = r !== null ? [r] : Object.keys(review.data.targets).map((n) => g.byName.get(n)).filter((i): i is number => i !== undefined);
    const on = (i: number) => {
      const j = toView(i);
      return j >= 0 && lit.set[j] === 1;
    };
    return litKeyEdges(roots.map((t) => flow.keys(t)), on).flatMap(([a, b]) => [toView(a), toView(b)]);
  };

  /** The tool on the mode buttons: Selection, Rests on with its steps beside it while it is the mode,
   *  Used by. The legend's edge key says what the edges are under the tool. */
  let keyLegend = false;
  const syncTool = () => {
    for (const b of document.querySelectorAll<HTMLElement>("#lightup [data-mode]")) {
      b.classList.toggle("on", b.dataset.mode === S.mode);
      b.setAttribute("aria-pressed", String(b.dataset.mode === S.mode));
    }
    const rests = restsOn(S.mode);
    $("#rests").classList.toggle("on", rests);
    $("#rests-btn").setAttribute("aria-pressed", String(rests));
    $("#rests-steps").hidden = !rests;
    document.body.dataset.mode = S.mode;
    if (keyLegend !== (S.mode === "keys")) {
      keyLegend = S.mode === "keys";
      legend.render();
    }
  };

  /** What a mode does, under its button while the pointer is on it (or it has the focus); null
   *  puts it away. It is said nowhere else: the reader who knows the modes is not told again. Rests
   *  on's button tells of the mode and each of its steps; a step's, of that step. */
  const modeTip = (b: HTMLElement | null) => {
    const tip = $("#mode-tip");
    if (!b) return void (tip.hidden = true);
    if (b.id === "rests-btn") {
      tip.innerHTML =
        `<b>Rests on</b> <span class="muted">· key 2, again for the next step</span><div>${escapeHtml(RESTS_HINT)}</div>` +
        `<ul class="tip-steps">${STEPS.map((m) => `<li><b>${MODE_NAME[m]}</b>: ${escapeHtml(STEP_HINT[m])}${m === "tcb" ? ` <span class="muted">(where it starts)</span>` : ""}</li>`).join("")}</ul>`;
    } else {
      const m = b.dataset.mode as Tool;
      const key = m === "plain" ? "key 1" : m === "apps" ? "key 3" : "a step of Rests on, key 2 steps";
      tip.innerHTML = `<b>${MODE_NAME[m]}</b> <span class="muted">· ${key}</span><div>${escapeHtml(MODE_HINT[m])}</div>`;
    }
    tip.hidden = false;
    const r = b.getBoundingClientRect();
    tip.style.top = `${r.bottom + 8}px`;
    tip.style.left = `${Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, r.left + r.width / 2 - tip.offsetWidth / 2))}px`;
  };
  for (const b of document.querySelectorAll<HTMLElement>("#lightup button")) {
    b.addEventListener("pointerenter", () => modeTip(b));
    b.addEventListener("pointerleave", () => modeTip(null));
    b.addEventListener("focus", () => modeTip(b));
    b.addEventListener("blur", () => modeTip(null));
  }

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

  /** What a query lights up on the board, for what a click covers (web/src/selection.ts). */
  const setOn = (q: Query) => litOn(q).set;

  /** A click with the tool (web/src/selection.ts, click): the selection becomes that pick, or with
   *  shift under Selection that one pick goes in or out; one step in the history. False when it
   *  changed nothing: a picked cluster covers it already, which the hint says. */
  const clickOn = (p: Pick, shift: boolean): boolean => {
    const r = click(picks, shown, p, shift, setOn);
    if (r.covered) {
      const names = views.titles().names ?? undefined;
      say(`${pickWords(p, names)} is inside ${pickWords(r.covered, names)}, which is selected: nothing changed.`);
      return false;
    }
    const before = picks.length;
    picks = r.picks;
    shown = r.shown;
    apply();
    commit();
    tipsOnClick(p, shift, before);
    return true;
  };

  /** The tips in place a reader's click may be the moment of (GuideSpec decision 9; web/src/tips.ts
   *  says each rule): under Selection, what was selected replaced three times in 20 s; under Rests
   *  on · TCB, a theorem's TCB lit by the reader's own click, and the fifth such pick ever, no other
   *  step having been chosen. */
  let replaced: number[] = [];
  const tipsOnClick = (p: Pick, shift: boolean, before: number) => {
    const decl = p.root && "decl" in p.root ? p.root.decl : null;
    if (S.mode === "plain") {
      if (shift) return didTip("selection-replace");
      if (!decl || !before) return;
      const now = Date.now();
      replaced = [...replaced.filter((t) => now - t < 20_000), now];
      if (replaced.length >= 3) offerTip("selection-replace");
    } else if (S.mode === "tcb" && decl) {
      const i = g.byName.get(decl);
      const q = selectionQuery(picks);
      if (i !== undefined && g.nodes[i].kind === "theorem" && q && litOn(q).count > 1) offerTip("tcb-first");
      if (countTip("tcb-picks", "rests-only-tcb") >= 5) offerTip("rests-only-tcb");
    }
  };
  /** The tips in place what is recorded may be the moment of: a target's second declaration
   *  approved on a view focused on it, while it has no key declaration; a key marked ends that. */
  let approvedInFocus = 0;
  const tipsOnReview = (op: ReviewRequest) => {
    if (op.op === "key" && op.on) return didTip("key-in-target");
    if (op.op !== "opinion" || op.verdict !== "approve") return;
    const r = reviewRoot();
    const i = g.byName.get(op.name);
    if (r === null || i === undefined || !flow.inReview(r, i) || keyMarks(review.data, g.nodes[r].name).length) return;
    if (++approvedInFocus >= 2) offerTip("key-in-target");
  };

  /** The tool in force: kept, with the step of Rests on it is (the step entering Rests on resumes,
   *  a reading preference of this browser). */
  const useTool = (m: Tool) => {
    S.mode = m;
    if (restsOn(m)) S.restsOn = m;
    store.save();
  };

  /** The tool (decided 2026-10-07): how the next click selects. With something selected, the
   *  pick last clicked is selected again under it, alone (web/src/selection.ts, retool): one step
   *  in the history. With nothing selected, only the tool changes, without a step. */
  const setMode = (m: Tool) => {
    if (m === S.mode) return;
    useTool(m);
    syncTool();
    const r = retool(picks, shown, m, (root) => keysFor(root));
    if (r.picks === picks) return writeAddress(false);
    picks = r.picks;
    shown = r.shown;
    apply();
    commit();
  };

  /** The tool chosen by the reader, by a mode's button or key: another step of Rests on than TCB
   *  is what two tips in place teach (web/src/tips.ts, tcb-first and rests-only-tcb) — the tour and
   *  Show me choose it otherwise, and teach nothing of it. */
  const readerMode = (m: Tool) => {
    if (m === "keys" || m === "deps" || m === "refs") {
      didTip("tcb-first");
      didTip("rests-only-tcb");
    }
    setMode(m);
  };

  /** Nothing selected; the visitors go with the selection (ViewSpec decision 27). */
  const clear = () => {
    picks = [];
    shown = null;
    visitors = [];
    apply();
  };

  // ---------------------------------------------------------------- visitors
  //
  // A declaration gone to that the board on show does not hold is a visitor on it (ViewSpec decision
  // 27; web/src/visitors.ts): the reader's own, in its own place in the cluster hierarchy — temporary
  // clusters added for the levels the board does not draw — drawn by the canvas with its edges to what
  // the board holds. The trail goes with the selection cleared or another board; one the board comes
  // to hold is a member, and leaves it.

  /** The trail's index of declaration `i` (the whole graph's numbering), or -1. */
  const visitorOf = (i: number): number => {
    const name = g.nodes[i]?.name;
    return name === undefined ? -1 : visitors.findIndex((v) => v.name === name);
  };
  /** Declaration `i`, which the board does not hold, a visitor on it, the newest of the trail,
   *  reached from `from` where that is on the board or a visitor. Its place is the canvas's to choose
   *  (drawVisitors); one that is a visitor already keeps its own. */
  const visitOn = (i: number, from: number | null) => {
    const reached = from !== null && from !== i && (toView(from) >= 0 || visitorOf(from) >= 0);
    visitors = visit(visitors, { name: g.nodes[i].name, from: reached ? g.nodes[from!].name : null, place: null });
  };
  /** What the board does not hold of where the reader is — the selection's declarations and what the
   *  panel tells of — made visitors where they are not yet (a link, a tab come back to, an agent
   *  followed, which says nothing of visitors). True where one was made. */
  const ensureVisitors = (): boolean => {
    const want = new Set(clickedDecls());
    const i = selected();
    if (i !== null) want.add(i);
    let made = false;
    for (const j of want) {
      if (toView(j) >= 0 || visitorOf(j) >= 0) continue;
      visitOn(j, null);
      made = true;
    }
    return made;
  };
  /** The visitors on the canvas, those selected ringed (and the folded clusters round them open for
   *  the reader): each with its colour in either scheme, its marks and its edges. Those the board
   *  holds now, or its graph does not have, are no visitors. The places the canvas chose are kept in
   *  the trail, which presence carries to followers. */
  const drawVisitors = () => {
    visitors = stillVisiting(visitors, (n) => {
      const i = g.byName.get(n);
      return i !== undefined && toView(i) < 0;
    });
    const r = reviewRoot();
    const targets = boardReview().targets;
    const index = new Map(visitors.map((v, k) => [v.name, k]));
    const points: VisitorPoint[] = visitors.map((v) => {
      const i = g.byName.get(v.name)!;
      const node = g.nodes[i];
      const edges = visitorEdges(g, i, toView, (u) => index.get(g.nodes[u].name) ?? -1);
      return {
        name: v.name,
        label: g.short(i),
        module: node.module,
        ext: g.isExt(i),
        place: v.place,
        kind: g.isExt(i) ? "external" : node.kind,
        axiom: ringed(node.kind),
        status: statusState(boardReview(), g, i, g.isExt(i) || pastShown() ? undefined : fileIndex.get(node.module), g.axiomsOf(i).includes("sorryAx")),
        target: Object.hasOwn(targets, v.name),
        key: r !== null && r !== i && flow.isKey(r, i),
        board: edges.board,
        visitors: edges.visitors,
      };
    });
    const sel = new Set([...clickedDecls(), ...(selected() !== null ? [selected()!] : [])].map((j) => visitorOf(j)).filter((k) => k >= 0));
    const places = canvas.setVisitors(points, [...sel], nav.board?.rec.hidden[cm()] ?? []);
    visitors = visitors.map((v, k) => {
      const p = places[k];
      return p && (v.place?.in !== p.in || v.place.at[0] !== p.at[0] || v.place.at[1] !== p.at[1]) ? { ...v, place: p } : v;
    });
    // a note attached to a visitor shows beside it
    stickies.render();
  };

  /** Bring a declaration into view: open what hides it, fly to it. `i` in the whole graph's
   *  numbering. */
  const reveal = (i: number) => {
    const j = toView(i);
    // a visitor: brought into view where it is out of it
    if (j < 0) {
      const at = canvas.visitorPos(visitorOf(i));
      if (!at) return;
      const [x, y] = at;
      const [sx, sy] = canvas.toScreen(x, y);
      const I = canvas.insets;
      const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
      if (sx < I.left + 20 || sx > W - I.right - 120 || sy < I.top + 20 || sy > H - I.bottom - 20) canvas.flyToPoint(x, y);
      return;
    }
    if (canvas.nodeRep[j] >= 0) canvas.toggleFold(canvas.nodeRep[j]);
    canvas.flyTo(j);
  };
  /** Bring what the panel tells of into view. */
  const revealShown = () => {
    const i = selected();
    if (i !== null) return reveal(i);
    const c = shownCluster();
    if (c >= 0) canvas.flyToCluster(c);
  };

  /** Go to a declaration (CanvasSpec, "Navigation"): a click there with the tool, and the view
   *  flies there; one step in the history. One the board does not hold is a visitor on it (ViewSpec
   *  decision 27), beside the declaration the reader comes from: navigation never leaves the board,
   *  and on a board of a past build the visitor is of that build. */
  const go = (i: number) => {
    if (toView(i) < 0) visitOn(i, selected());
    const p = pickDecl(g.nodes[i].name);
    picks = [p];
    shown = shownOf(p);
    apply();
    reveal(i);
    commit();
  };
  /** Go to a cluster of the board (a row of a cluster's panel): a click there with the tool. */
  const goCluster = (c: number) => {
    picks = [pickCluster(c)];
    shown = shownOf(picks[0]);
    apply();
    canvas.flyToCluster(c);
    commit();
  };

  /** The board on show is of another graph (a past build's, or the graph on show again): what
   *  speaks of the whole graph — the panel, the review, the search, the source windows — speaks of
   *  it. A pinned window shows its declaration there, found by name: on a past board, as that build
   *  had it (HistorySpec decision 23). */
  const useGraph = (G: Graph) => {
    g = G;
    panel.g = g;
    reviewBox.g = g;
    searchBox.setGraph(g);
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

  /** Go to a declaration of the board's graph, by name — a visitor where the board does not hold it;
   *  false where the graph does not have it. */
  const goName = (name: string): boolean => {
    const i = g.byName.get(name);
    if (i === undefined) return false;
    go(i);
    return true;
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
    offerTip("first-time-machine");
    if (!at.name || goName(at.name)) return true;
    say(`${at.name} is not in the graph of that build.`);
    return true;
  };

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
    const at = here();
    await views.load();
    const id = r.view.id;
    const ok = await tm.leaveFor(() => nav.show(id, at));
    sync.afterPost();
    if (!ok) return `“${name}” is made, kept at that build: it is in Views.`;
    // the tabs were hidden while it was shown: drawn again now, its tab brought into sight
    renderTabs();
    commit();
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
      visitors = [];
      visitorsOn = b.id;
      canvas.setVisitors([], [], []);
    }
    if (b.full !== g) useGraph(b.full);
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
    canvas.setBuild(b.past ? null : build?.files ?? null);
    // the whole project's layout holds the outside world; a scope without it hides it
    canvas.setShowExternals(b.bs.whole ? b.bs.outside : true);
    for (const btn of document.querySelectorAll<HTMLElement>("#board-pop [data-cluster]")) btn.classList.toggle("on", btn.dataset.cluster === m);
    $("#side-what").textContent = m === "module" ? "Files" : "Namespaces";
    notes.clear();
    syncStatus();
    applyScheme();
    showLevel();
    syncPeers();
    boardPanel.render();
    renderHidden();
    apply();
    syncPast();
  };

  /** Take a place on the board on show: the tool, the selection, what the panel tells of, and the
   *  camera — or, without one, what the panel tells of (flown to from the whole board, when the
   *  board is new), or the whole board. */
  const place = (p: Place, fresh: boolean) => {
    if (TOOLS.includes(p.mode)) useTool(p.mode);
    else store.save();
    picks = readSelection(p.picks);
    shown = p.shown ?? null;
    // the reader's own focus there, where they chose one (a place kept by an older page has none)
    mine = p.focus === null || typeof p.focus === "string" ? p.focus : undefined;
    // a followed reader's visitors, where they are on their board (ViewSpec decision 27)
    if (p.visitors) visitors = p.visitors;
    apply();
    if (p.cam) {
      canvas.cam = { ...p.cam };
      canvas.request();
    } else if (fresh) canvas.fit(false);
    // what the board does not hold of where the reader is, visitors in their places
    if (ensureVisitors()) apply();
    if (!p.cam && (selected() !== null || shownCluster() >= 0)) revealShown();
  };
  const here = (): Place => ({ cam: { ...canvas.cam }, mode: S.mode, picks: selectionText(picks), shown, ...(mine !== undefined ? { focus: mine } : {}) });

  /** Zoom in: a view of what is lit, in a tab of its own, with the same selection; at the board's
   *  build (from the Time Machine too, which is left for it), focused as this view is (ViewSpec
   *  decision 28), and, where it is new, clustered as this board is, as a cluster's Zoom in is (one
   *  found open keeps its own). */
  const zoomIn = async () => {
    const q = zoomOf(selectionQuery(picks));
    if (!q) return;
    const r = await openDerived(printQuery(q), { mode: S.mode, picks: selectionText(picks), shown, cam: null }, cm());
    if (typeof r === "string") say(r);
    else if (r) {
      canvas.fit(false);
      commit();
    }
  };
  /** The scope of a view of a cluster alone (its panel's Zoom in): what of it this board holds, as
   *  Zoom in has it; null when that is the whole board. */
  const clusterScope = (c: number): Query | null => zoomOf(clusterSet(canvas.layout.clusters[c].key, cm()));
  /** Zoom in on a cluster: a view of it alone, in a tab, clustered as this board is (a folder is
   *  shown by file), with the same selection; at the board's build. */
  const zoomCluster = async (c: number) => {
    const mode = cm();
    const scope = clusterScope(c);
    if (!scope) return;
    const r = await openDerived(printQuery(scope), { mode: S.mode, picks: selectionText(picks), shown, cam: null }, mode);
    if (typeof r === "string") return say(r);
    if (!r) return;
    // a view found open has its own clustering: it is given this board's, unless it is a preview
    if (cm() !== mode && !frozen()) await sync.setClustering(mode);
    canvas.fit(false);
    commit();
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
      mine = name;
      go(i);
      writeAddress(false);
      return;
    }
    if (noSwitch()) return;
    const p = pickDecl(name, name);
    const to: Place = { mode: S.mode, picks: selectionText([p]), shown: shownOf(p), cam: null, focus: name };
    if (linked !== undefined) {
      void nav.select(linked, to).then((ok) => {
        if (ok) commit();
        // its view deleted meanwhile: the target on the board on show
        else go(i);
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
      commit();
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
    apply();
    renderTabs();
    say(`★${short(name)} is linked to this view now: clicking ★${short(name)} opens it.`);
    return null;
  };

  // ---------------------------------------------------------------- history and the address
  //
  // Every step (a click on a declaration, a row, a name; another view) is an entry in the browser's
  // history, with the state in the address, so back and forward work as they do anywhere and every
  // view is a link. The camera travels in the entry, not the address.

  let navTop = 0;
  const current = (): ViewState => ({
    view: nav.query() === null ? nav.board.id : null,
    scope: nav.query(),
    // a view nobody keeps, of a past build: the build travels with its query
    version: nav.queryVersion(),
    mode: S.mode,
    picks: selectionText(picks),
    shown,
  });
  const entry = () => (history.state && typeof history.state.n === "number" ? (history.state as { n: number; cam?: object; tm?: number }) : { n: 0 });
  /** The address of what this reader sees, with its snapshot (CollabSpec decision 7): what a link to
   *  what they see carries, whatever Share's switch (decision 13); the address alone where the
   *  snapshot cannot be made. */
  const seenHash = async (): Promise<string> => {
    const hash = encodeState(current());
    const snap = await writeSnapshot(followedOf(parts.read), canvas.screen).catch(() => null);
    return snap ? withSnapshot(hash, snap).slice(1) : hash;
  };
  /** In the Time Machine, the build its board shows travels in the entry (not the address: where a
   *  reader is in it is their own, HistorySpec decision 18), so that back and forward return to a
   *  past board at its build (the owner's decision of 2026-10-09). */
  const tmEntry = (): { tm?: number } => (tm.active && tm.shown !== null && tm.shown !== tm.latest ? { tm: tm.shown } : {});
  const renderNav = () => {
    const back = entry().n > 0, forward = entry().n < navTop;
    $<HTMLButtonElement>("#nav-back").disabled = !back;
    $<HTMLButtonElement>("#nav-fwd").disabled = !forward;
    steps = { back, forward };
    sources.following?.setNav(back, forward);
  };
  /** Write the state into the address: a new entry (`push`) or the current one. */
  const writeAddress = (push: boolean) => {
    // a view still being opened (a link, back, forward): the address already says where it goes
    if (!push && nav.busy) return;
    const hash = "#" + encodeState(current()) + filmPart;
    try {
      if (push && hash !== location.hash) {
        // the entry being left remembers where the camera was
        history.replaceState({ ...entry(), cam: { ...canvas.cam } }, "");
        const n = entry().n + 1;
        history.pushState({ n, ...tmEntry() }, "", hash);
        navTop = n;
      } else if (hash !== location.hash) {
        const { tm: _was, ...rest } = entry();
        history.replaceState({ ...rest, ...tmEntry() }, "", hash);
      }
    } catch {
      // a browser that refuses: the page works, the address just does not follow
    }
    renderNav();
    nav.remember();
    people.report();
  };
  const commit = () => writeAddress(true);

  /** Take a state from the address (a link, back, forward): its view, opened again from its query
   *  if need be; the camera from the entry if it has one. */
  const restore = async (st: ViewState, cam: { x: number; y: number; k: number } | null, tmAt?: number) => {
    const to: Place = { mode: st.mode, picks: st.picks, shown: st.shown, cam };
    const id = st.view ?? (st.scope ? null : PROJECT);
    // an entry made in the Time Machine returns to its build
    const atBuild = async () => {
      if (typeof tmAt !== "number") return;
      if (!tm.active) await tm.open({ snapshot: tmAt });
      else if (tm.snapshot !== tmAt) await tm.show(tmAt);
    };
    if (id === nav.board.id || (!id && st.scope === nav.query() && (st.version ?? null) === nav.queryVersion())) {
      // a view still being laid out for a step before is not gone to after all
      stay();
      place(to, false);
      return atBuild();
    }
    // back or forward to another view: the Time Machine is left, as views are not switched in it
    if (tm.active) await tm.close();
    if (id && (await nav.select(id, to))) return atBuild();
    // a view nobody keeps opens again at the build it showed
    const opened = st.scope ? await nav.open(st.scope, to, { version: st.version ?? null }) : false;
    if (opened === true) return atBuild();
    // gone, or never there (an address typed or kept): the Project, and why
    await nav.select(PROJECT, to);
    if (typeof opened === "string") say(`This link's view could not be opened: ${opened}`);
    else if (id && id !== PROJECT && !views.summary(id)) say(VIEW_GONE);
  };
  /** Take what the address says (a link, back, forward): its board; a link with a snapshot opened in
   *  this tab, then what its sharer saw, once; an artwork's recipe, once; the note a link names. */
  const followAddress = (cam: { x: number; y: number; k: number } | null, tmAt?: number): Promise<void> => {
    const st = decodeState(location.hash);
    const snap = snapshotIn(location.hash);
    const recipe = recipeIn(location.hash);
    const note = noteIn(location.hash);
    return (st ? restore(st, cam, tmAt) : Promise.resolve())
      .then(() => (snap ? openSnapshot(snap).then(() => writeAddress(false)) : undefined))
      .then(() => {
        // the recipe is read: the address goes back to the board's at once, as at the first load
        if (!recipe) return;
        void openRecipe(recipe);
        writeAddress(false);
      })
      .then(() => {
        if (note) showNote(note.ofView ? nav.board.id : "", note.id);
        // the address names what is shown (CanvasSpec, "Navigation"), also where it named a view
        // that is gone or what no state reads as
        writeAddress(false);
        renderNav();
        people.report();
      });
  };
  window.addEventListener("popstate", (e) => {
    const cam = (e.state as { cam?: { x: number; y: number; k: number } } | null)?.cam ?? null;
    const tmAt = (e.state as { tm?: unknown } | null)?.tm;
    void followAddress(cam, typeof tmAt === "number" ? tmAt : undefined);
  });
  /** A link of this site followed from a conversation (CollabSpec decision 13): its address applied
   *  in the page as a share link is — its board, what its sharer saw, the note it names — without a
   *  reload; a step of the reader's history, which Back returns from. */
  const openAddress = (hash: string) => {
    const to = "#" + hash.replace(/^#/, "");
    try {
      // the entry being left remembers where the camera was
      history.replaceState({ ...entry(), cam: { ...canvas.cam } }, "");
      const n = entry().n + 1;
      history.pushState({ n }, "", to);
      navTop = n;
    } catch {
      return;
    }
    void followAddress(null);
  };
  $("#nav-back").addEventListener("click", () => history.back());
  $("#nav-fwd").addEventListener("click", () => history.forward());
  // the review strip: its target's name goes back to the target
  $("#lens-title").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-go]");
    if (b) walk(Number(b.dataset.go));
  });

  /** A new graph from the server, swapped in where the reader is: same view, same camera, same
   *  selection (by name and key, which a new numbering leaves as they are); every board is
   *  computed again. A board of a past build stays one, measured against the new graph. */
  const install = async (next: ViewMeta, edges: ArrayBuffer) => {
    meta = next;
    present = new Graph(meta, new Int32Array(edges));
    compiled = new Map(meta.modules.map((m) => [m.name, m.compiled]));
    edits.clear();
    served.clear();
    servedContexts.clear();
    data.forget();
    // the pinned windows show their declarations in the new graph, found by name, as the files are
    // now (the following window follows the selection, found by name too); on a past board they
    // stay on its build, whose graph is made again against the new one as the board is drawn
    if (!pastShown()) {
      for (const w of sources.all) w.g = present;
      sources.redraw((name) => present.byName.get(name));
    }
    views.graphChanged();
    tm.presentChanged();
    targetTcbs.clear();
    // a declaration selected that this build renamed: the selection is on its name now
    const followed = followSelection();
    // the board on show again, of the new graph (showBoard takes it as `g`)
    await nav.redraw();
    trust.render();
    activity.changed();
    if (followed) selectionFollowed();
  };

  // ---------------------------------------------------------------- build status

  const pill = $("#build");
  const pop = $("#build-pop");
  const bar = $<HTMLElement>("#progress > div");
  const shortName = (m: string) => m.split(".").slice(-2).join(".");

  const renderBuild = () => {
    if (data.snapshot) return;
    pill.hidden = false;
    let cls = "ok";
    let text = "Built";
    const c = build?.counts;
    if (offline && updatingTo) {
      cls = "building";
      text = `Updating to ${updatingTo}…`;
    } else if (offline) {
      cls = "off";
      text = "Offline";
    } else if (reloadOffered) {
      text = "Updated — reload";
    } else if (build?.active) {
      cls = "building";
      const p = build.progress;
      // a branch's build: its step, where Lake says nothing of its progress (DeploySpec)
      text = p ? `Building ${p.done} / ${p.total}` : deploy?.building ? stepPill(deploy.building) : "Building";
      if (p?.current.length) text += ` · ${shortName(p.current[0])}${p.current.length > 1 ? ` +${p.current.length - 1}` : ""}`;
    } else if (c && c.failed + c.unbuilt > 0) {
      cls = "bad";
      text = `${c.failed + c.unbuilt} failed` + (c.blocked ? ` · ${c.blocked} blocked` : "");
    } else if (deploy?.last && !deploy.last.ok) {
      // a branch's build that failed with no file to show it (its lakefile, a fetch)
      cls = "bad";
      text = `${deploy.last.retry ? "Not built" : "Build failed"} · ${deploy.last.commit.slice(0, 7)}`;
    } else if (c && c.stale > 0) {
      cls = "stale";
      text = `${c.stale} out of date`;
    } else if (c && c.sorry > 0) {
      cls = "warn";
      text = `Built · ${c.sorry} with sorry`;
    }
    if (updating) text += " · reading…";
    else if (graphInfo?.missing.length) text += " · partial graph";
    // the usage pass runs: the notation each declaration is written in, and its exact context, come
    // with the next graph (server/usage.ts)
    else if (graphInfo?.usage?.state === "pending") text += " · reading notation…";
    pill.className = `build-pill ${cls}`;
    pill.querySelector(".b-text")!.textContent = text;
    const prog = build?.active && build.progress ? build.progress.done / Math.max(1, build.progress.total) : 0;
    bar.style.width = `${Math.round(prog * 100)}%`;
    bar.parentElement!.classList.toggle("on", !!build?.active);
    if (!pop.hidden) renderPop();
  };

  /** the builds the history keeps, as last read (undefined: being read; null: none kept here) */
  let builds: { snapshots: BuildLine[]; current: number | null } | null | undefined;
  /** the builds read again, once the popover shows them */
  let buildsStale = true;
  const readBuilds = () => {
    buildsStale = false;
    void (data.lost?.builds() ?? Promise.resolve(null)).then((b) => {
      builds = b;
      if (!pop.hidden) renderPop();
    });
  };
  const renderPop = () => {
    if (buildsStale) readBuilds();
    const html = popHtml({
      graph: graphInfo,
      extractError,
      files: build?.files ?? null,
      stateLabel: STATE_LABEL,
      builds: data.lost ? builds : null,
      lost: lostDrawer.counts,
      deploy,
    });
    // drawn again as the build goes on: the keyboard keeps its place in it
    keepFocus(pop, () => (pop.innerHTML = html));
    // a build's log is read from its end, where it says what failed
    for (const l of pop.querySelectorAll<HTMLElement>(".bp-log")) l.scrollTop = l.scrollHeight;
  };

  /** Show a file: its cluster where the board clusters by file, else its first declaration. The
   *  clustering is the board's, everyone's: going somewhere does not change it. A file the board
   *  does not hold is shown by its first declaration, a visitor (ViewSpec decision 27). */
  const goToModule = (m: string) => {
    const c = canvas.layout.clusters.findIndex((cl) => cl.key === m);
    if (c >= 0) {
      if (canvas.folded.has(c)) canvas.toggleFold(c);
      return canvas.flyToCluster(c);
    }
    const i = g.nodes.findIndex((v, j) => v.module === m && !g.isExt(j));
    if (i < 0) return;
    if (toView(i) >= 0) return canvas.flyTo(toView(i));
    go(i);
  };

  /** Show what a trusted prefix covers: its cluster on this board if it is one here, or else the
   *  first declaration it covers (gone to, so that it shows where the outside world is hidden). */
  const goToPrefix = (p: string) => {
    // the cluster that stands for the prefix as the outline's rows do: outside the project, a
    // cluster by namespace is not what a prefix trusts there
    const c = canvas.layout.clusters.findIndex((cl) => clusterPrefix(cl, cm()) === p);
    if (c >= 0 && (!canvas.layout.clusters[c].ext || nav.board.bs.outside || !nav.board.bs.whole)) {
      if (canvas.folded.has(c)) canvas.toggleFold(c);
      return canvas.flyToCluster(c);
    }
    const i = g.nodes.findIndex((v, j) => covers(p, v.name, v.module, g.isExt(j)));
    if (i >= 0) go(i);
  };

  // the build-status popover (HistorySpec decision 15, web/src/buildpop.ts): it closes on a press
  // elsewhere, Esc, or the pill again
  const buildPop = new Popover(pill, pop, { changed: (open) => open && renderPop() });
  pop.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>("[data-module]");
    if (b) return goToModule(b.dataset.module!);
    const bp = t.closest<HTMLElement>("[data-bp]")?.dataset.bp;
    const snap = t.closest<HTMLElement>("[data-snapshot]")?.dataset.snapshot;
    if (!bp && snap === undefined) return;
    buildPop.toggle(false);
    if (bp === "lost") lostDrawer.toggle(true);
    else timeMachine(snap !== undefined ? { snapshot: Number(snap) } : undefined);
  });

  // the views as they are, sent on every (re)connection: the first is what the page loaded with
  let reconnected = false;
  /** Follow the server: what it sends goes to the view on show, so it starts once one is. */
  // the page follows its server into another version (UpdateSpec decision 8, web/src/reload.ts): it
  // reloads where it is, unless that would cut short what the reader is doing; the pill offers it
  // meanwhile, and a click on it reloads at once
  const reloader = new Reloader({
    busy: () => {
      const a = document.activeElement;
      if ((a instanceof HTMLTextAreaElement || (a instanceof HTMLInputElement && (a.type === "text" || a.type === "search"))) && a.value.trim()) return "text being typed";
      if (a instanceof HTMLElement && a.isContentEditable) return "text being typed";
      if (stickies.editing) return "a note being written";
      if (canvas.pressed) return "a drag";
      if (exportModal.isOpen) return "the export window";
      if (artLook) return "the artwork mode";
      if (linear.shown) return "the linear form";
      return null;
    },
    kept: () => ({
      root: meta.project.root,
      at: Date.now(),
      sources: {
        following: sources.following ? { name: sources.following.name, collapsed: sources.following.collapsed } : null,
        pinned: sources.pinned.map((p) => ({ name: p.name, collapsed: p.collapsed })),
      },
      review: reviewBox.keptDrafts,
      talk: talk.keptDrafts,
      notes: reader ? [...ownOpen] : [],
    }),
    offer: (v) => {
      reloadOffered = v;
      renderBuild();
    },
    reload: () => location.reload(),
  });
  pill.addEventListener(
    "click",
    (e) => {
      if (!reloadOffered) return;
      e.stopImmediatePropagation();
      reloader.go();
    },
    true,
  );
  /** The build status the page now holds, shown: the pill, the Status colours, the outline, the
   *  panel's banners. */
  const takeBuild = (status: BuildStatus | null) => {
    build = status;
    fileIndex = files();
    canvas.setBuild(pastShown() ? null : build?.files ?? null);
    syncStatus();
    outline.render();
    renderBuild();
    // a file may have been edited: what was read of the sources, and what was known of them, goes
    data.forget();
    edits.clear();
    served.clear();
    servedContexts.clear();
    sources.redraw((name) => g.byName.get(name));
    showSelected();
  };
  // the first reading is the one made as the page loaded
  const liveBuild = new LiveBuild(() => {
    const first = firstBuild;
    firstBuild = null;
    return first ?? data.build();
  }, takeBuild);
  const listen = () => {
    if (data.snapshot) return;
    // the build status read as the page loaded, shown now that a board is
    if (firstBuild) void liveBuild.fetch();
    // the server names the stream, and tells this page alone the secret its heartbeats carry: the
    // others see the page go when it closes; it takes the build status as changes
    const es = new EventSource(`/api/events?session=${people.session}&build=delta`);
    es.addEventListener("hello", (e) => {
      const hello = JSON.parse((e as MessageEvent).data) as StreamHello;
      // the conversations are read again once the heartbeat named this page's stream: what of them
      // it is sent depends on the name (CollabSpec decision 13)
      void people.connected(hello).then(() => !reader && talk.connected());
      updatingTo = null;
      reloader.hello(hello.server);
      // the release this page's code is of, once it is the server's (GuideSpec decision 11): a page
      // about to reload into another tells nothing, so that What's new waits for the new code
      const release = hello.server?.version;
      if (release && (!PAGE_VERSION || release === PAGE_VERSION)) hearRelease(release);
      renderBuild();
    });
    // the server restarts into another version (UpdateSpec decision 8): the pill says so while it is
    // away, and the page reloads into it when it is back
    es.addEventListener("update", (e) => {
      updatingTo = (JSON.parse((e as MessageEvent).data) as { to?: string }).to ?? null;
      renderBuild();
    });
    es.addEventListener("presence", (e) => people.setPeers(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("private", (e) => people.setPrivateCount((JSON.parse((e as MessageEvent).data) as PrivateCount).count));
    // the people invited by a personal link, as they are called now (CollabSpec decision 9): what
    // each did shows under that name, in Activity and on the notes
    es.addEventListener("people", (e) => {
      setPeople(JSON.parse((e as MessageEvent).data) as Invited[]);
      activity.changed();
      stickies.render();
    });
    es.addEventListener("activity", (e) => activity.add(JSON.parse((e as MessageEvent).data)));
    // the lost-and-found changed: how many entries it lists (HistorySpec decision 12); a build was
    // kept: the popover's recent builds are read again
    es.addEventListener("lost", (e) => lostDrawer.news(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("history", () => {
      buildsStale = true;
      if (!pop.hidden) renderPop();
    });
    es.addEventListener("chat", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as ChatEvent;
      talk.add(d.channel, d.message);
    });
    // a request to follow someone, its answers to this page's own, and one ended on the server
    // (CollabSpec decision 10)
    es.addEventListener("ask", (e) => asking.asked(JSON.parse((e as MessageEvent).data) as AskFollow));
    es.addEventListener("ask-answer", (e) => asking.answered(JSON.parse((e as MessageEvent).data) as AskAnswered));
    es.addEventListener("ask-end", (e) => asking.ended((JSON.parse((e as MessageEvent).data) as { id: string }).id));
    es.addEventListener("views", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      if (d.all && !reconnected) {
        reconnected = true;
        d.all = false;
      }
      sync.listed(d);
      // the page was away: the project's notes are read again too
      if (d.all) void projectNotes.load().then(() => stickies.render());
    });
    // the project's notes, as another page, an agent or the server changed them
    es.addEventListener("note-ops", (e) => {
      if (projectNotes.take(JSON.parse((e as MessageEvent).data))) stickies.render();
    });
    es.addEventListener("view-ops", (e) => sync.ops(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("view-memory", (e) => sync.memory(JSON.parse((e as MessageEvent).data)));
    es.onopen = () => {
      offline = false;
      renderBuild();
    };
    es.onerror = () => {
      offline = true;
      renderBuild();
      // refused rather than lost (a server with as many pages open as it serves): the browser does
      // not try again by itself, so the page does, a while later — unless the link this page came by
      // was revoked (CollabSpec decisions 9 and 11), which the server says (410): the page is
      // reloaded, and the server's page says the link no longer opens the site (decision 7)
      if (es.readyState === EventSource.CLOSED)
        void fetch("/api/identity")
          .then((r) => (r.status === 410 ? location.reload() : setTimeout(listen, 10_000)))
          .catch(() => setTimeout(listen, 10_000));
    };
    // the build status (web/src/buildread.ts): which revision the server holds, as the stream opens
    // and at a change sent as no delta; each change after as the files whose status changed; a
    // server from before 0.6.0 sends it whole
    es.addEventListener("build-rev", (e) => liveBuild.told(JSON.parse((e as MessageEvent).data) as BuildRev));
    es.addEventListener("build-delta", (e) => liveBuild.delta(JSON.parse((e as MessageEvent).data) as BuildDelta));
    es.addEventListener("build", (e) => liveBuild.whole(JSON.parse((e as MessageEvent).data) as BuildStatus));
    // a build read: the Time Machine's timeline has a tick more (HistorySpec, the snapshots)
    es.addEventListener("history", () => void tm.historyChanged());
    // which review the server holds (as the stream opens, and at a change that is no delta): read
    // again where this page holds another; what changes comes as deltas
    es.addEventListener("review-rev", (e) => wholeReview.told(JSON.parse((e as MessageEvent).data) as ReviewRev));
    // the branch's builds (DeploySpec): the pill and the popover say them
    es.addEventListener("deploy", (e) => {
      deploy = JSON.parse((e as MessageEvent).data);
      renderBuild();
    });
    es.addEventListener("review-delta", (e) => takeChange(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("extracting", () => {
      updating = true;
      renderBuild();
    });
    es.addEventListener("idle", () => {
      updating = false;
      renderBuild();
    });
    es.addEventListener("extract-error", (e) => {
      extractError = JSON.parse((e as MessageEvent).data).error;
      renderBuild();
    });
    es.addEventListener("graph", async (e) => {
      const info: GraphInfo = JSON.parse((e as MessageEvent).data);
      extractError = null;
      // the same version of the same server's: nothing new (a server restarted counts again)
      if (graphInfo && info.version === graphInfo.version && info.instance === graphInfo.instance) return;
      try {
        const [next, edges] = await Promise.all([data.meta(info.version, info.instance), data.edges(info.version, info.instance)]);
        graphInfo = info;
        await install(next, edges);
      } catch {
        // superseded while loading: the next graph event brings the newer one
      }
      renderBuild();
    });
  };

  // ---------------------------------------------------------------- toolbar

  for (const b of document.querySelectorAll<HTMLElement>("#lightup [data-mode]")) {
    b.addEventListener("click", () => readerMode(b.dataset.mode as Tool));
  }
  // Rests on: entered at the step last used; while it is the mode its steps are beside it
  $("#rests-btn").addEventListener("click", () => {
    if (!restsOn(S.mode)) readerMode(enterStep(S.restsOn));
  });
  for (const b of document.querySelectorAll<HTMLElement>("#board-pop [data-cluster]")) {
    b.addEventListener("click", () => void sync.setClustering(b.dataset.cluster as ClusterMode));
  }
  /** The outside world on this board or not: a condition of its scope, everyone's (a target's
   *  view's too: ViewSpec decision 28); the Project always holds it (decision 5). */
  const toggleOutside = () => {
    if (fixedScope(nav.board.rec)) return say(PROJECT_SCOPE);
    void sync.setScope(setOutside(nav.board.rec.scope, withoutOutside(nav.board.rec.scope))).then((why) => why && say(why));
  };
  // the depth of the whole board, one level at a time; the level shown is read from the folds, so
  // it stays right after folding by hand
  showLevel = () => {
    if (!canvas.layout) return;
    const max = canvas.maxDepth() + 1;
    const now = canvas.openLevels();
    $("#fold-level").textContent = now >= max ? "All open" : `${now} / ${max}`;
    $<HTMLButtonElement>("#fold-less").disabled = now <= 0;
    $<HTMLButtonElement>("#fold-more").disabled = now >= max;
  };
  $("#fold-less").addEventListener("click", () => canvas.stepLevels(-1));
  $("#fold-more").addEventListener("click", () => canvas.stepLevels(1));
  $("#zoom-in").addEventListener("click", () => canvas.zoomBy(1.6));
  $("#zoom-out").addEventListener("click", () => canvas.zoomBy(1 / 1.6));
  $("#zoom-fit").addEventListener("click", () => canvas.fit());
  applyTheme();
  themeChoices($("#theme-seg"));
  // the lock, the edges and the theme, behind the eyes' ⋯ (decided 2026-10-08); their keys stay
  const eyesPop = new Popover($("#eyes-btn"), $("#eyes-pop"));
  // the reader's eyes, at the bottom right: edges drawn (proof edges are no more: the owner's
  // decision of 2026-10-15)
  const edgesBtn = $("#edges-btn");
  const syncEdges = () => {
    edgesBtn.classList.toggle("on", S.showEdges);
    edgesBtn.setAttribute("aria-pressed", String(S.showEdges));
    // an artwork's, while its mode is on (drawLook)
    canvas.setEdges(artLook ? artLook.edges !== "none" : S.showEdges);
  };
  // what the board draws, which those following this reader see too (CollabSpec decision 4)
  setEdges = (edges) => {
    if (edges === S.showEdges) return;
    S.showEdges = edges;
    store.save();
    syncEdges();
    people.report();
  };
  edgesBtn.addEventListener("click", () => setEdges(!S.showEdges));
  syncEdges();
  // the layout locked, also the reader's own and kept in this browser (web/src/drag.ts): a drag pans
  // the view, never moves a thing, unless the reader lets the lock go (decided 2026-10-09: panning
  // is the default). The drag key — ⌘ on a Mac, where Ctrl+click is the right click, and Ctrl
  // elsewhere — held does the other while it is held; the canvas reads the key at each press, and the
  // button shows which way a drag goes now and names the key.
  const lockBtn = $("#lock-btn");
  let locked = lockedChoice();
  let held = false;
  /** whether a drag on a declaration, a circle or a note moves it now */
  const dragging = () => dragMoves(locked, held);
  const syncLock = () => {
    const on = !dragging();
    lockBtn.classList.toggle("on", on);
    lockBtn.classList.toggle("held", held);
    lockBtn.querySelector(".eye-l")!.textContent = locked ? "Layout locked" : "Drag moves nodes";
    // ⋯ says so while a drag moves things, which is not the default and is out of sight behind it,
    // and while the drag key is held
    $("#eyes-btn").classList.toggle("flag", !on);
    $("#eyes-btn").classList.toggle("held", held);
    lockBtn.setAttribute("aria-pressed", String(locked));
    canvas.setLocked(locked);
  };
  const toggleLock = () => {
    locked = !locked;
    setLockedChoice(locked);
    syncLock();
  };
  lockBtn.addEventListener("click", toggleLock);
  lockBtn.title =
    "The lock, on by default: a drag pans the view, never a declaration, a circle or a note; clicks still select. " +
    `Let it go and a drag moves them, for everyone on this board (l). Hold ${dragKeyName()} for the other way while held.`;
  const holding = (e: KeyboardEvent) => isDragKey(e.key);
  window.addEventListener("keydown", (e) => {
    if (holding(e) && !held) {
      held = true;
      syncLock();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (holding(e) && held) {
      held = false;
      syncLock();
    }
  });
  // a key let go elsewhere (another window, another tab) is never heard of
  window.addEventListener("blur", () => {
    if (!held) return;
    held = false;
    syncLock();
  });
  syncLock();
  // a fresh start for everyone on this board: its pins go (in both ways of clustering) and it is
  // laid out anew — the Project's by the server; other boards keep theirs. It is done under a name,
  // and the timeline says whose.
  const relayout = async () => {
    if (frozen()) return say(frozenWhy());
    const title = views.title(nav.board.id);
    if (!confirm(`Lay "${title}" out afresh for everyone on it? Its pins are dropped, for everyone, and everything on it moves. Other views keep theirs.`)) return;
    if (!data.snapshot && !(await people.ensureLayout())) return;
    const r = await sync.change("relayout", {});
    if (r.error) say(r.error);
    else if (data.snapshot) {
      // no server to send the pins' going back: the board is laid out afresh here
      views.ops(nav.board.id, [{ op: "clear" }]);
      views.memory(nav.board.id, cm(), null, null);
      void nav.redraw();
    }
  };
  $("#relayout").addEventListener("click", () => void relayout());

  // ---------------------------------------------------------------- the canvas's menu
  //
  // A right click on the canvas, or the ContextMenu key or Shift+F10 on what is selected (ViewSpec,
  // "The canvas's menu", decided 2026-10-09): what can be done with a declaration, a cluster or the
  // empty canvas, as web/src/ctxmenu.ts lists it, each item doing what the page does elsewhere —
  // the panel's review, the modes, Duplicate, the scope chips, trusting from the side panel.

  /** What the menu is open on: the target, its declaration in the whole graph's numbering or its
   *  cluster on the board, the part of a scope it is (decl(X), or the cluster's set), and where. */
  let menuOn: { t: MenuTarget; i?: number; c?: number; note?: string; part: Query | null; world: [number, number]; at: { x: number; y: number }; linear?: boolean; artName?: string } | null = null;
  const ctxMenu = new ContextMenu($("#ctxmenu"), {
    chose: (act, name) => void menuAct(act, name),
    // what it was open on was lit for it: no longer
    closed: () => canvas.preview(null),
  });
  // a right click elsewhere on the page keeps the browser's menu; while this one is open, it is
  // the only one (the ContextMenu key reaches the page as a right click too)
  document.addEventListener("contextmenu", (e) => {
    if (ctxMenu.open) e.preventDefault();
  });
  /** A name can be had for what is recorded under one: given here, or by the proxy. */
  const canName = () => !data.snapshot && !reader && (!!people.name || people.mode === "declared");
  /** Whether two scopes hold the same set, on the whole graph and the review as they are. */
  const sameSet = (a: Query, b: Query): boolean => {
    const x = evaluate(a, { g, review: boardReview() }), y = evaluate(b, { g, review: boardReview() });
    for (let j = 0; j < x.length; j++) if (x[j] !== y[j]) return false;
    return true;
  };
  /** A namespace to trust from the menu, where trusting it can be done from here (TrustTo). */
  const trustOf = (prefix: string | null): TrustTo | null => {
    if (!prefix || !validPrefix(prefix)) return null;
    const by = review.data.trusted.filter((t) => under(prefix, t));
    return by.includes(prefix) ? { prefix, on: true } : by.length ? null : { prefix, on: false };
  };
  /** Where the menu is open and what the reader may do there. `part`: what it is open on, as a part
   *  of a scope — the kept views that hold all of it already are said so. */
  const menuContext = (part: Query | null): MenuContext => {
    const rec = nav.board.rec;
    const has = part && evaluate(part, { g, review: boardReview() });
    const holds = (scope: string): boolean => {
      if (!has) return false;
      try {
        const set = evaluate(parseQuery(scope), { g, review: boardReview() });
        for (let j = 0; j < has.length; j++) if (has[j] && !set[j]) return false;
        return true;
      } catch {
        return false;
      }
    };
    return {
      fixed: fixedScope(rec),
      review: reviewName(),
      // every view whose scope can change, the kept ones first, then those open now and not kept
      // yet, which adding to keeps (ViewSpec decision 21)
      views: views.summaries
        .filter((v) => !fixedScope(v) && v.id !== rec.id)
        .sort((a, b) => Number(b.kept) - Number(a.kept))
        .slice(0, 40)
        .map((v) => ({ id: v.id, title: views.title(v.id), holds: holds(v.scope), ...(v.kept ? {} : { temporary: true }) })),
      // a preview of the view at another build is arranged by nobody here; a past build is not
      // reviewed (the owner's decision of 2026-10-10)
      arrange: (!!data.snapshot || canName()) && !frozen(),
      here: fixedScope(rec) ? null : rec.id,
      write: canName() && !blocked() && !pastShown(),
      past: pastShown(),
      preview: frozen(),
      // a phone: a source takes the whole screen, nothing is pinned beside it (PhoneSpec decision 13)
      noPin: isPhone(),
      // a link to it, without the key, wherever there is a server to open it (CollabSpec decision 13)
      link: !data.snapshot,
    };
  };
  /** Open the menu on what is at a point of the window: a declaration or a cluster of the board,
   *  or the empty canvas; `keys`: from the keyboard; `folded`: a cluster folded where the menu is
   *  open (the linear form's own folds). What it is open on is lit while it is. */
  const openMenu = (t: Target | null, x: number, y: number, world: [number, number], keys = false, folded?: boolean) => {
    const title = views.title(nav.board.id);
    // the menu says what it is on: the pointer's tooltip goes
    $("#tip").hidden = true;
    if (t?.kind === "node" || t?.kind === "visitor") {
      // a visitor is a declaration as any, but for what is on the board (ViewSpec decision 27)
      const visitor = t.kind === "visitor";
      const i = visitor ? g.byName.get(visitors[t.k]?.name ?? "") : toFull(t.i);
      if (i === undefined) return;
      const name = g.nodes[i].name;
      const r = reviewRoot();
      // an artwork's names by selection: its name shown in the picture, or not (ExportSpec decision 19)
      const artName = t.kind === "node" ? artNameId("decl", canvas.g.nodes[t.i].name) : undefined;
      const inArt = artName ? art.nameChosen(artName) : undefined;
      const mt: MenuTarget = {
        kind: "decl",
        name,
        ext: g.isExt(i),
        key: r !== null && flow.keyable(r, i) ? keyMarked(boardReview(), g.nodes[r].name, name) : null,
        target: Object.hasOwn(boardReview().targets, name),
        ns: g.isExt(i) ? null : trustOf(name.split(".").slice(0, -1).join(".") || null),
        ...(visitor ? { visitor: true } : {}),
        ...(inArt !== undefined ? { art: inArt } : {}),
      };
      // a scope is written in the names of now, as a move keeps it (a past graph's renamed one)
      menuOn = { t: mt, i, part: { op: "decl", names: [declNow(i)] }, world, at: { x, y }, ...(artName ? { artName } : {}) };
      if (t.kind === "node") canvas.preview(t.i);
      ctxMenu.show(menuItems(mt, menuContext(menuOn.part), title), x, y, name, keys);
    } else if (t?.kind === "cluster") {
      const cl = canvas.layout.clusters[t.c];
      const st = trust.state(cl, cm());
      const artName = artNameId("cluster", cl.key);
      const inArt = art.nameChosen(artName);
      const mt: MenuTarget = {
        kind: "cluster",
        key: cl.key,
        folded: folded ?? canvas.folded.has(t.c),
        folder: cm() === "module",
        trust: st.prefix && (st.on || !st.by) ? { prefix: st.prefix, on: st.on } : null,
        ...(inArt !== undefined ? { art: inArt } : {}),
      };
      menuOn = { t: mt, c: t.c, part: clusterSet(cl.key, cm()), world, at: { x, y }, artName };
      canvas.previewCluster(t.c);
      ctxMenu.show(menuItems(mt, menuContext(menuOn.part), title), x, y, cl.key.replace("⟨external⟩", "External"), keys);
    } else {
      const mt: MenuTarget = { kind: "canvas" };
      menuOn = { t: mt, part: null, world, at: { x, y } };
      ctxMenu.show(menuItems(mt, menuContext(null), title), x, y, title, keys);
    }
  };
  /** The ContextMenu key or Shift+F10: the menu on what the panel tells of, where it is on the
   *  canvas (kept within the canvas's free part), or on the empty canvas in its middle. */
  const menuOnSelection = () => {
    const I = canvas.insets;
    const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
    const inside = (p: [number, number]): [number, number] => [Math.max(I.left + 8, Math.min(W - I.right - 8, p[0])), Math.max(I.top + 8, Math.min(H - I.bottom - 8, p[1]))];
    const i = selected();
    const c = shownCluster();
    let t: Target | null = null;
    let at: [number, number];
    const k = i === null ? -1 : visitorOf(i);
    if (i !== null && toView(i) >= 0) {
      t = { kind: "node", i: toView(i) };
      at = canvas.toScreen(...canvas.posOf(toView(i)));
    } else if (k >= 0 && canvas.visitorPos(k)) {
      t = { kind: "visitor", k };
      at = canvas.toScreen(...canvas.visitorPos(k)!);
    } else if (c >= 0) {
      t = { kind: "cluster", c };
      at = canvas.screenOf("cluster", canvas.layout.clusters[c].key)!;
    } else at = [I.left + (W - I.left - I.right) / 2, I.top + (H - I.top - I.bottom) / 2];
    const [x, y] = inside(at);
    openMenu(t, x, y, canvas.toWorld(x, y), true);
  };
  /** Copy text to the clipboard; where the browser refuses (a page not served securely), through a
   *  field selected for the moment. */
  const copyText = async (text: string, said = `Copied ${text}`) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const f = document.createElement("textarea");
      f.value = text;
      f.style.cssText = "position: fixed; opacity: 0; pointer-events: none";
      document.body.append(f);
      f.select();
      document.execCommand("copy");
      f.remove();
    }
    say(said);
  };
  /** Copy link (ViewSpec decision 21, CollabSpec decision 13): a link to what the menu was opened on
   *  — a declaration, a cluster, a note — or, on the empty canvas, to what the reader sees (decision
   *  7's snapshot, whatever Share's switch), on the board on show; never with the key. The page says
   *  it was copied, as a conversation will show it. */
  const copyLinkTo = async (on: NonNullable<typeof menuOn>) => {
    const t = on.t;
    const base = current();
    let hash: string;
    if (t.kind === "decl") hash = encodeState({ ...base, picks: selectionText([pickDecl(t.name)]), shown: { decl: t.name } });
    else if (t.kind === "cluster" && on.c !== undefined) hash = encodeState({ ...base, picks: selectionText([pickCluster(on.c)]), shown: { cluster: t.key } });
    else if (t.kind === "cluster") hash = encodeState({ ...base, picks: null, shown: { cluster: t.key } });
    else if (t.kind === "note" && on.note) hash = noteHash(encodeState(base), on.note, noteOf(on.note)?.kind === "view");
    else hash = await seenHash();
    const url = copyLink({ origin: site.base, pathname: location.pathname }, hash);
    const c = chipFor(url);
    await copyText(url, `Link copied: ${c ? chipText(c) : "this page"}. It carries no key: whoever opens it must be let in already.`);
  };
  /** What the menu was open on, in a few words. */
  const menuWhat = (t: MenuTarget) => (t.kind === "decl" ? short(t.name) : t.kind === "cluster" ? short(t.key) : "it");
  /** Take `part` out of the board on show (`scope except part`): for everyone on it; on the Project,
   *  whose scope stays, in a copy of it named `name`, shown in a tab. */
  const removeFromBoard = async (part: Query, what: string, name?: string) => {
    const rec = nav.board.rec;
    const next = scopeWithout(rec.scope, part, sameSet);
    if (sameQuery(next, rec.scope)) return say(`This board does not hold ${what}.`);
    if (!fixedScope(rec)) {
      const why = await sync.setScope(next);
      if (why) say(why);
      return;
    }
    const why = (await named()) ?? (await made(await views.post("create", { name: name ?? `${views.title(rec.id)} without ${what}`, from: rec.id, scope: printQuery(next) })));
    if (why) say(why);
  };
  /** Add `part` to a view (`scope or part`), for everyone on it: a kept one, or the board on show,
   *  where a visitor so becomes a member (ViewSpec decision 27), shown at once. */
  const addToView = async (id: string, part: Query, what: string) => {
    const v = views.summary(id);
    const here = id === nav.board.id;
    if (!v && !here) return;
    let scope: Query;
    try {
      scope = here ? nav.board.rec.scope : parseQuery(v!.scope);
    } catch {
      return say(`The scope of “${views.title(id)}” cannot be read here.`);
    }
    const next = scopeWith(scope, part, sameSet);
    if (sameQuery(next, scope)) return say(`“${views.title(id)}” holds ${what} already.`);
    if (here) {
      const why = await sync.setScope(next);
      return say(why ?? `Added ${what} to this view: a member of it now.`);
    }
    const r = await views.post("scope", { id, scope: printQuery(next) });
    if (r.who) people.lost();
    if (r.error) return say(r.error);
    sync.afterPost();
    say(`Added ${what} to “${views.title(id)}”.`);
  };
  // ---------------------------------------------------------------- notes
  //
  // A note is the project's unless it is made a view's (AttachmentSpec decisions 13–19): the
  // project's are written, edited, moved, opened or collapsed and deleted as operations on the
  // project's notes (web/src/projectnotes.ts), a view's as the view's operations (shared/sticky.ts);
  // both are applied here at once and sent to everyone, the server recording who wrote one as it
  // records who dropped a pin. Writing, editing and deleting one is under the reader's name (the
  // timeline says who); opening and moving one, as a fold and a pin, are not. Where a note goes on a
  // board is the notes layer's (web/src/sticky.ts, placeFor).

  /** Change the notes of the board on show's view, for everyone on it. */
  const noteOps = (ops: NoteOp[]) => {
    sync.arrange(ops);
    stickies.render();
  };
  /** Change the project's notes, for everyone, from a board that can be arranged. `here`: the notes
   *  written are written in the board on show, which they are added to (the owner's decision of
   *  2026-10-11: what is written or dropped in a view is that view's, wherever it is put), but on the
   *  Project, which holds every one. Resolves to why they were refused, said already, or null. */
  const projectOps = async (ops: ProjectNoteOp[], here = false): Promise<string | null> => {
    if (frozen()) {
      say(frozenWhy());
      return frozenWhy();
    }
    const written = here && !fixedScope(nav.board.rec) ? nav.board.id : null;
    const added: ItemOp[] = written ? ops.flatMap((o): ItemOp[] => (o.op === "pnote" ? [{ op: "item", note: o.note.id, in: "add" }] : [])) : [];
    const r = projectNotes.send(ops, written);
    // the view's record takes them at once, as the server's answer does for the others
    if (written && added.length) views.ops(written, added);
    stickies.render();
    const { error, who } = await r;
    if (who) people.lost();
    if (error) {
      // refused: what this page applied at once is taken back, as the server holds them
      say(error);
      await projectNotes.load();
      if (written && added.length) views.ops(written, added.map((o) => ({ ...o, in: null })));
    }
    stickies.render();
    return error;
  };
  /** A note on the board on show, of either kind, by its id. */
  const noteOf = (id: string): { kind: NoteKind; note: ProjectNote | StickyNote } | null => {
    const v = nav.board.rec.notes?.find((n) => n.id === id);
    if (v) return { kind: "view", note: v };
    const p = projectNotes.get(id);
    return p ? { kind: "project", note: p } : null;
  };
  /** Whether note `id` is open on this page: as its reader left it, where it is theirs alone. */
  const noteOpenHere = (id: string): boolean => ownOpen.get(id) ?? !!noteOf(id)?.note.open;
  /** Open note `id`, or collapse it: for everyone, as its own state; on a read-only reader's page for
   *  them alone, which shares nothing (CollabSpec decision 11). */
  const setNoteOpen = (id: string, open: boolean) => {
    const n = noteOf(id);
    if (!n) return;
    if (reader) {
      ownOpen.set(id, open);
      stickies.render();
    } else if (n.kind === "project") void projectOps([{ op: "pnote-open", id, open }]);
    else noteOps([{ op: "note-open", id, open }]);
  };
  /** A note let go somewhere: attached to a declaration — its place under every clustering, its
   *  places beside it where it falls back to — or detached from the one it was attached to and put
   *  at its place under the board's clustering, or its view note's place (the owner's decision of
   *  2026-10-12). */
  const moveNote = (id: string, d: Dropped) => {
    const had = noteOf(id)?.note.decl;
    const attach = d.decl || had ? d.decl : undefined;
    const to = d.to;
    if (to?.kind === "view" || (!to && nav.board.rec.notes?.some((n) => n.id === id))) {
      const ops: NoteOp[] = [];
      if (attach !== undefined) ops.push({ op: "note-decl", id, decl: attach });
      if (to?.kind === "view") ops.push({ op: "note-move", id, place: to.place });
      if (ops.length) noteOps(ops);
      return;
    }
    const ops: ProjectNoteOp[] = [];
    if (attach !== undefined) ops.push({ op: "pnote-decl", id, decl: attach });
    if (to) ops.push({ op: "pnote-move", id, mode: to.mode, place: to.place });
    if (d.also) ops.push({ op: "pnote-move", id, mode: d.also.mode, place: d.also.place });
    if (ops.length) void projectOps(ops);
  };
  /** Write a note at a spot of the board, in an editor at a point of the window: the project's
   *  (Add a note here), or this view's own (Add a note for this view). */
  const writeNote = async (kind: NoteKind, at: { x: number; y: number }, world: [number, number]) => {
    if (frozen()) return say(frozenWhy());
    const why = await named();
    if (why) return say(why.replace("A view is made", "A note is written"));
    const board = nav.board.id;
    const label = kind === "project" ? (fixedScope(nav.board.rec) ? "A note of the project, on the Project and every view whose scope gives it" : "A note of the project, on this view, the Project and every view whose scope gives it") : `A note of “${views.title(board)}” alone`;
    stickies.edit(at, "", label, (text) => {
      if (text === null || nav.board.id !== board) return;
      const to = stickies.placeFor(kind, world);
      if (!to) return;
      const who = { open: true, by: people.name, at: new Date().toISOString() };
      if (to.kind === "project") void projectOps([{ op: "pnote", note: { id: newNoteId(), text, places: { [to.mode]: to.place }, ...who } }], true);
      else noteOps([{ op: "note", note: { id: newNoteId(), text, place: to.place, ...who } }]);
    });
  };
  /** Edit a note's text, in an editor over it. */
  const editNote = async (id: string, at?: { x: number; y: number }) => {
    const n = noteOf(id);
    if (!n) return;
    if (frozen()) return say(frozenWhy());
    const why = await named();
    if (why) return say(why.replace("A view is made", "A note is edited"));
    const board = nav.board.id;
    stickies.edit(stickies.screenOf(id) ?? at ?? { x: innerWidth / 2 - 150, y: innerHeight / 3 }, n.note.text, "Edit the note", (text) => {
      if (text === null || text === n.note.text || nav.board.id !== board || !noteOf(id)) return;
      // stamped here as the server stamps it, which it does again under the name it takes
      const edit = { id, text, by: people.name, at: new Date().toISOString() };
      if (n.kind === "project") void projectOps([{ op: "pnote-edit", ...edit }]);
      else noteOps([{ op: "note-edit", ...edit }]);
    });
  };
  /** Make a note the other kind, keeping its text, its author and where it is on this board: a note
   *  of the project this view's own (Only in this view), or this view's the project's (In every
   *  view). */
  const switchNote = async (id: string) => {
    const n = noteOf(id);
    if (!n) return;
    if (frozen()) return say(frozenWhy());
    const why = await named();
    if (why) return say(why.replace("A view is made", "A note is made the project's or a view's"));
    const spot = stickies.spotOf(id);
    const to: NoteKind = n.kind === "project" ? "view" : "project";
    const at = spot && stickies.placeFor(to, spot);
    if (!at) return say("That note is not on the board now: bring it into view first.");
    // sent as no page's: the server tells every page, this one too, which applies both sides then
    const r = await views.post("note-kind", { id: nav.board.id, note: id, to, place: at.place, mode: cm(), token: null });
    if (r.who) people.lost();
    if (r.error) return say(r.error);
    // a snapshot has no stream to hear it on: both sides are read again
    if (data.snapshot) {
      await projectNotes.load();
      await views.record(nav.board.id, true);
    }
    stickies.render();
    say(to === "view" ? `The note is “${views.title(nav.board.id)}”'s alone now.` : "The note is the project's now: the Project, this view and every view whose scope gives it show it.");
  };
  // ---------------------------------------------------------------- items
  //
  // A note of the project is an item, and items belong to views as declarations do (the owner's
  // decision of 2026-10-11, shared/items.ts): the Project holds every one; another view shows what
  // its scope gives and what was added to it, less what was taken out. The note's menu adds it to
  // another view (Add to view ▸) or takes it out of this one (Remove from this view), for everyone on
  // that view, as Add to view and Remove from this view change a declaration's view; what is written
  // or dropped in a view is added to it (projectOps).

  /** Whether a view's scope gives a note by itself (shared/noteplace.ts, derivesOn): the board on
   *  show as it is (a past build's, with the links as it reads them), another view by its scope on
   *  the graph on show; null where its scope cannot be read here. */
  const derivedIn = (v: { id: string; scope: string; clustering: ClusterMode }): ((n: ProjectNote) => boolean) | null => {
    if (v.id === nav.board.id) return derivesOn(cm(), vg().nodes, existsIn(nav.board.full.nodes), boardReview().links, nav.board.past?.past.nowName);
    try {
      const set = evaluate(parseQuery(v.scope), { g, review: review.data });
      return derivesOn(v.clustering, g.nodes.filter((_, i) => set[i]), existsIn(g.nodes), review.data.links);
    } catch {
      return null;
    }
  };
  /** What a note of the project's menu offers of the views: every view whose scope can change but
   *  this one, the kept ones first, each saying whether it shows the note already (✓); and whether it
   *  can be taken out of this one (not on the Project). */
  const noteViews = (n: ProjectNote): { views: { id: string; title: string; holds: boolean; temporary?: boolean }[]; remove: boolean } => {
    const rec = nav.board.rec;
    const views_ = views.summaries
      .filter((v) => !fixedScope(v) && v.id !== rec.id)
      .sort((a, b) => Number(b.kept) - Number(a.kept))
      .slice(0, 40)
      .map((v) => {
        const listed = v.items?.add.includes(n.id) ? "add" : v.items?.remove.includes(n.id) ? "remove" : null;
        const holds = listed !== "remove" && (listed === "add" || !!derivedIn(v)?.(n));
        return { id: v.id, title: views.title(v.id), holds, ...(v.kept ? {} : { temporary: true }) };
      });
    return { views: views_, remove: !fixedScope(rec) };
  };
  /** Add note `id` of the project to view `to` (Add to view ▸), or take it out of the board on show
   *  (`to` null: Remove from this view), for everyone on that view: on its add list only where its
   *  scope does not give it, on its remove list only where it does (shared/items.ts, itemOp). */
  const itemTo = async (id: string, to: string | null) => {
    const n = projectNotes.get(id);
    if (!n) return;
    const here = to === null || to === nav.board.id;
    const rec = nav.board.rec;
    const v = here ? { id: rec.id, scope: printQuery(rec.scope), clustering: rec.clustering, items: rec.items } : views.summary(to!);
    if (!v) return;
    const gives = derivedIn(v);
    if (!gives) return say(`The scope of “${views.title(v.id)}” cannot be read here.`);
    const op = itemOp(here ? nav.board.rec.items : v.items, id, to === null ? "remove" : "add", gives(n));
    const what = `the note “${noteExcerpt(n.text, 40)}”`;
    if (!op) return say(to === null ? `This view does not show ${what}.` : `“${views.title(v.id)}” shows ${what} already.`);
    if (here) {
      await sync.arrange([op]);
      stickies.render();
      return say(`Took ${what} out of this view; the Project and every other view keep it as they had it.`);
    }
    const r = await views.post("arrange", { id: v.id, ops: [op] });
    if (r.who) people.lost();
    if (r.error) return say(r.error);
    // a snapshot has no server to tell it: its record of the view takes it here
    if (data.snapshot) views.ops(v.id, [op]);
    sync.afterPost();
    say(`Added ${what} to “${views.title(v.id)}”.`);
  };

  /** A note's menu: edit, open or collapse, the other kind, add it to a view or take it out of this
   *  one, delete. */
  const openNoteMenu = (id: string, x: number, y: number) => {
    const n = noteOf(id);
    if (!n) return;
    const t: MenuTarget = {
      kind: "note",
      open: noteOpenHere(id),
      view: n.kind === "view",
      ...(reader ? { own: true } : {}),
      carries: (n.note.carries ?? []).map(carryLabel),
      attach: !data.snapshot && !reader,
      ...(n.kind === "project" ? { items: noteViews(n.note as ProjectNote) } : {}),
    };
    const items = menuItems(t, menuContext(null));
    if (!items.length) return;
    $("#tip").hidden = true;
    menuOn = { t, note: id, part: null, world: canvas.toWorld(x, y), at: { x, y } };
    const by = n.note.by ? ` by ${nameNow(n.note.by, n.note.person)}${n.note.person ? " ✓" : ""}` : "";
    ctxMenu.show(items, x, y, `${n.kind === "view" ? "This view's note" : "Note"}${by}`);
  };

  // ---------------------------------------------------------------- what notes carry
  //
  // A note carries files of the library and clips of their pages (AttachmentSpec decision 12): a
  // file dropped on the canvas, or an image pasted, is added to the library and makes a note of the
  // project carrying it where it was let go, its title as its text, open for editing; a box of a
  // PDF's page is made into a note from the reference window (Clip to a note); and a note's menu
  // attaches a file or a clip to it (Attach…) or takes one off (Detach). Changing what a note carries
  // is an edit of the note, under the reader's name, as an edit of its text is.

  /** Why no note can be made, or given what it carries, on this board: a preview of a view, which
   *  nothing arranges, or a snapshot of the page, which has no library. Null where it can. */
  const noteRefused = (): string | null =>
    frozen() ? frozenWhy() : data.snapshot ? "A snapshot of the page carries no library: a note carries the files the server keeps." : null;

  /** A file or a clip a note carries, in a few words: what the note's menu lists. */
  const carryLabel = (c: NoteCarry): string => {
    const f = fileOf(review.data, c.file);
    if (!f) return "A file the library has no record of";
    const title = f.title.length > 48 ? f.title.slice(0, 47) + "…" : f.title;
    return f.type !== "pdf" ? title : c.region ? `A clip of ${title}, p. ${c.page}` : c.page ? `${title}, p. ${c.page}` : title;
  };

  /** Edit what note `n` carries, its text as it is: an edit of the note. Why it was refused, or null. */
  const editCarries = async (n: { kind: NoteKind; note: ProjectNote | StickyNote }, carries: NoteCarry[]): Promise<string | null> => {
    const edit = { id: n.note.id, text: n.note.text, carries, by: people.name, at: new Date().toISOString() };
    if (n.kind === "project") return projectOps([{ op: "pnote-edit", ...edit }]);
    noteOps([{ op: "note-edit", ...edit }]);
    return null;
  };

  /** Say why something was not done; false, for what answers whether it was. */
  const refused = (why: string): false => {
    say(why);
    return false;
  };

  /** Attach a file or a clip to note `id` (its menu's Attach…). Whether it was. */
  const attachTo = async (id: string, c: NoteCarry): Promise<boolean> => {
    const no = noteRefused();
    if (no) return refused(no);
    const n = noteOf(id);
    if (!n) return refused("That note is not on this board any more.");
    const why = await named();
    if (why) return refused(why.replace("A view is made", "A note is edited"));
    const next = withCarry(n.note.carries, c);
    if (typeof next === "string") return refused(next);
    if (await editCarries(n, next)) return false;
    say(`Attached ${carryLabel(c)} to the note.`);
    return true;
  };

  /** Take the `k`-th of what note `id` carries off it (its menu's Detach): the file stays in the
   *  library. */
  const detach = async (id: string, k: number) => {
    const n = noteOf(id);
    const c = n?.note.carries?.[k];
    if (!n || !c) return;
    const no = noteRefused();
    if (no) return say(no);
    const why = await named();
    if (why) return say(why.replace("A view is made", "A note is edited"));
    if (!(await editCarries(n, n.note.carries!.filter((_, j) => j !== k)))) say(`${carryLabel(c)} is off the note; it stays in the library.`);
  };

  /** Open note `id`'s editor once it is drawn, the view brought to it first where it does not show
   *  or shows collapsed (a note made from the reference window, perhaps far from what is in view). */
  const editWhenShown = (id: string, bring: boolean) => {
    const look = stickies.lookOf(id);
    if (bring && look !== "open") {
      stickies.flyTo(id);
      setTimeout(() => void editNote(id), 620);
    } else void editNote(id);
  };

  /** Where a note made from the reference window goes (Clip to a note): beside the declaration
   *  selected on the board, in its cluster; in the cluster selected; else on the ring, in the order
   *  notes were written. With where that is, in words. */
  const clipPlace = (): { places: ProjectNote["places"]; where: string } | null => {
    const i = selected();
    const j = i === null ? -1 : toView(i);
    const c = shownCluster();
    const to = j >= 0 ? stickies.placeBeside(j) : c >= 0 ? stickies.placeInCluster(c) : null;
    if ((j >= 0 || c >= 0) && !to) return null;
    if (!to) return { places: {}, where: "on the ring around the board" };
    const key = "in" in to.place ? to.place.in[0][0] : null;
    return { places: { [to.mode]: to.place }, where: key ? `in ${key.split(".").slice(-2).join(".")}` : "on the ring around the board" };
  };

  /** Clip to a note, from the reference window: a note of the project carrying the clip, with that
   *  text, open for editing. Whether it was made. */
  const clipToNote = async (c: NoteCarry, text: string): Promise<boolean> => {
    const no = noteRefused();
    if (no) return refused(no);
    const why = await named();
    if (why) return refused(why.replace("A view is made", "A note is written"));
    const at = clipPlace();
    if (!at) return refused("This board is not drawn yet.");
    const id = newNoteId();
    if (await projectOps([{ op: "pnote", note: { id, text, places: at.places, open: true, by: people.name, at: new Date().toISOString(), carries: [c] } }], true)) return false;
    say(`Clipped to a note ${at.where}.`);
    editWhenShown(id, true);
    return true;
  };

  /** Files dropped on the canvas at a point of the window, or an image pasted: each added to the
   *  library and made a note of the project carrying it, spaced apart from that spot, its title as
   *  its text; one alone opens for editing. A file the library refuses says why and makes no note. */
  const addNotesOf = async (files: File[], at: { x: number; y: number }) => {
    const no = noteRefused();
    if (no) return say(no);
    // a file is added to the library under a name, as a link is made (AttachmentSpec decision 1)
    if (!(await people.ensure())) return say("A file is added to the library under your name: give one first.");
    const board = nav.board.id;
    const spots = stickies.placesFor(canvas.toWorld(at.x, at.y), files.length);
    if (!spots) return say("This board is not drawn yet.");
    const refusals: string[] = [];
    const made = await notesOfFiles(files, spots, {
      upload: (f) => uploadFile(f, papers.headers()),
      take: (c) => takeChange(c),
      write: (note) => projectOps([{ op: "pnote", note }], true),
      still: () => nav.board.id === board,
      say: (text) => say(text),
      refused: (why) => void refusals.push(why),
      by: people.name,
      lost: () => people.lost(),
    });
    if (made.length === 1) editWhenShown(made[0], false);
    // what was refused is said with the notes made, which would otherwise say over it
    else if (made.length) say(`${made.length} notes made, each carrying its file: double-click one to add words.${refusals.map((r) => ` ${r}`).join("")}`);
  };

  /** Whether an event is on the canvas: the board itself, a card on it, or a note — not a panel, a
   *  bar or a window over it. */
  const onCanvas = (t: EventTarget | null): boolean => {
    const el = t as HTMLElement | null;
    return !!el && (el.id === "canvas" || !!el.closest?.("#stickies, #cards"));
  };
  // a file dragged over the canvas is taken there, and let go it makes a note at that spot; dropped
  // on the Library's list, it is added there alone (web/src/library.ts)
  window.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("Files") || !onCanvas(e.target)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("drop", (e) => {
    if (e.defaultPrevented || !onCanvas(e.target)) return;
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    void addNotesOf(files, { x: e.clientX, y: e.clientY });
  });
  /** where the pointer last was over the canvas: where a pasted image makes its note */
  let pointerAt: { x: number; y: number } | null = null;
  window.addEventListener(
    "pointermove",
    (e) => {
      pointerAt = onCanvas(e.target) ? { x: e.clientX, y: e.clientY } : pointerAt;
    },
    { passive: true },
  );
  // an image pasted, anywhere but in a field, makes a note where the pointer last was on the canvas,
  // else in the middle of what is in view; it is named by when it was pasted, as it has no name
  document.addEventListener("paste", (e) => {
    if (typing(e.target) || typing(document.activeElement)) return;
    const images = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    e.preventDefault();
    const d = new Date();
    const two = (n: number) => String(n).padStart(2, "0");
    const when = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}`;
    const pasted = images.map((f, k) => new File([f], `Pasted image ${when}${images.length > 1 ? ` (${k + 1})` : ""}.${f.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png"}`, { type: f.type }));
    const I = canvas.insets;
    void addNotesOf(pasted, pointerAt ?? { x: (I.left + innerWidth - I.right) / 2, y: (I.top + innerHeight - I.bottom) / 2 });
  });

  /** Do what was chosen in the menu. */
  const menuAct = async (act: string, name?: string) => {
    const on = menuOn;
    if (!on) return;
    const t = on.t;
    const what = menuWhat(t);
    const i = on.i;
    if (act.startsWith("add:")) return on.part && addToView(act.slice(4), on.part, what);
    if (act.startsWith("detach:")) return on.note ? void detach(on.note, Number(act.slice(7))) : undefined;
    if (act.startsWith("item:")) return on.note ? void itemTo(on.note, act.slice(5)) : undefined;
    switch (act) {
      case "art-name":
        if (on.artName && (t.kind === "decl" || t.kind === "cluster")) art.showName(on.artName, !t.art);
        return;
      case "source":
        if (i !== undefined) sources.show(i);
        return;
      case "pin":
        if (i !== undefined) sources.openPinned(i);
        return;
      case "tcb":
      case "deps":
      case "apps":
        // a pick under that mode, as its button does
        if (t.kind !== "decl") return;
        useTool(act);
        syncTool();
        clickOn(pickDecl(t.name), false);
        return;
      case "copy":
        if (t.kind === "decl") await copyText(t.name);
        return;
      case "link":
        await copyLinkTo(on);
        return;
      case "remove":
      case "remove-new":
        if (on.part) await removeFromBoard(on.part, what, name);
        return;
      case "add-new": {
        if (!on.part) return;
        const why = (await named()) ?? (await made(await views.post("create", { name: name ?? what, scope: printQuery(on.part) })));
        if (why) say(why);
        return;
      }
      case "key":
        if (i !== undefined) toggleKey(i);
        return;
      case "target": {
        if (t.kind !== "decl" || !(await people.ensure())) return;
        const why = await submit({ op: "target", name: t.name, on: !t.target });
        if (why) say(why);
        return;
      }
      case "approve":
      case "comment": {
        // the review box, in the panel, with the focus where the opinion is given
        if (i === undefined) return;
        if (selected() !== i) go(i);
        setTimeout(() => {
          const box = act === "approve" ? $("#panel").querySelector<HTMLElement>('[data-rv="approve"]') : $("#panel").querySelector<HTMLElement>("[data-rv-comment]");
          box?.focus();
          box?.scrollIntoView({ block: "nearest" });
        }, 60);
        return;
      }
      case "trust": {
        const to = t.kind === "decl" ? t.ns : t.kind === "cluster" ? t.trust : null;
        if (to) trust.ask(to.prefix, !to.on, on.at);
        return;
      }
      case "fold":
        if (on.linear && t.kind === "cluster") linear.toggleFold(t.key);
        else if (on.c !== undefined) canvas.toggleFold(on.c);
        return;
      case "hide":
        if (t.kind === "cluster") hideLevel(t.key);
        return;
      case "fit":
        if (on.linear) linear.fit();
        else canvas.fit();
        return;
      case "relayout":
        await relayout();
        return;
      case "note":
      case "note-view":
        await writeNote(act === "note" ? "project" : "view", on.at, on.world);
        return;
      case "note-edit":
        if (on.note) await editNote(on.note, on.at);
        return;
      case "note-toggle":
        if (on.note) setNoteOpen(on.note, !noteOpenHere(on.note));
        return;
      case "note-kind":
        if (on.note) await switchNote(on.note);
        return;
      case "item-remove":
        if (on.note) await itemTo(on.note, null);
        return;
      case "note-attach": {
        const n = on.note ? noteOf(on.note) : null;
        const no = noteRefused();
        if (no) return say(no);
        if (n) papers.chooseToAttach(n.note.id, noteExcerpt(n.note.text, 40));
        return;
      }
      case "note-delete": {
        const n = on.note ? noteOf(on.note) : null;
        const where = n?.kind === "project" ? "the project, for everyone, on the Project and every view that shows it" : `“${views.title(nav.board.id)}”, for everyone on it`;
        if (!n || !confirm(`Delete this note from ${where}?\n\n${n.note.text.slice(0, 200)}`)) return;
        if (await named()) return;
        if (n.kind === "project") void projectOps([{ op: "pnote-delete", id: n.note.id }]);
        else noteOps([{ op: "note-delete", id: n.note.id }]);
        return;
      }
    }
  };

  // ---------------------------------------------------------------- search

  const input = $<HTMLInputElement>("#search");
  const searchBox = new SearchBox(input, $("#results"), g, { go: (i) => go(i) });

  // a file chosen by a button that is a label holding a hidden file field (the library's Upload, a
  // missing file's Add it…): Enter or Space on it opens the chooser, as a click does — the control's
  // own press, not a key of the page's
  document.addEventListener(
    "keydown",
    (e) => {
      const t = e.target as HTMLElement | null;
      const press = e.key === "Enter" || e.key === " ";
      const field = press && t?.matches?.("label[role=button]") ? t.querySelector<HTMLInputElement>("input[type=file]") : null;
      if (!field) return;
      e.preventDefault();
      e.stopPropagation();
      field.click();
    },
    true,
  );

  // ---------------------------------------------------------------- keyboard

  window.addEventListener("keydown", (e) => {
    // the source window the key is pressed in, if any: its keys are its own (web/src/sources.ts,
    // routeKey), the rest are the page's as anywhere — the windows are not modal
    const win = sources.at(e.target);
    // typing into a field: the keys are text; Esc only leaves the field — inside a source window,
    // for the window, where the next Esc closes it
    if (typing(e.target) || typing(document.activeElement)) {
      if (e.key === "Escape" && e.target !== input && !$("#modal").contains(e.target as Node)) {
        if (win) win.el.focus();
        else (e.target as HTMLElement).blur();
      }
      return;
    }
    // the conversation's window keeps its keys (Enter and Space on its buttons and links); Esc there
    // stops following (web/src/people.ts)
    if ((e.target as Element | null)?.closest?.("#following:not([hidden])")) return;
    if (exportModal.isOpen) {
      if (e.key === "Escape") exportModal.close();
      return;
    }
    if (!$("#modal").hidden || !$("#help").hidden) return;
    // the canvas's menu, on what is selected
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      menuOnSelection();
      return;
    }
    // in the artwork mode, the keys that act on the board alone: Search, the tool, the zoom, the
    // outside world, the levels, the lock — not those that open what the mode puts away
    if (artLook && !ART_KEYS.has(e.key)) return;
    // with Ctrl or ⌘ a letter is the browser's (Ctrl L, Ctrl F, …), and the drag key held is the lock's
    if ((e.ctrlKey || e.metaKey) && e.key.length === 1) return;
    const route = routeKey(e.key, win !== null, !!(e.target as Element | null)?.closest?.("button, a[href], summary, select"));
    // Space on a window's button or link presses it
    if (route === "press") return;
    // and on any button reached from the keyboard, as everywhere (surfaces.ts: Enter or Space on a
    // control presses it); on one the pointer pressed last, where the focus stays, Space is the page's
    // key for the source
    if (e.key === " " && (e.target as Element | null)?.matches?.(":focus-visible") && (e.target as Element).closest("button, summary")) return;
    if (win && route === "close") {
      e.preventDefault();
      sources.close(win);
      return;
    }
    if (win && route === "own") {
      // approve, comment on or mark key the window's own declaration, as its buttons do: in a pinned
      // window that is not the selection
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      e.preventDefault();
      if (e.key === "k") toggleKey(win.decl);
      else reviewBox.give(e.key === "a" ? "approve" : "comment", win.decl, win.el);
      return;
    }
    if (e.key === "/") {
      e.preventDefault();
      searchBox.focus();
    } else if (e.key === "1") readerMode("plain");
    // Rests on, at the step last used; pressed again, its next step (web/src/selection.ts, keyTwo)
    else if (e.key === "2") readerMode(keyTwo(S.mode, S.restsOn));
    else if (e.key === "3") readerMode("apps");
    else if (e.key === " ") {
      // Space opens and closes the source window that follows the selection, and opens it again
      // from its pill (CanvasSpec, "Hover, click, drag"); on a past board, the text of that build.
      // Closing it closes the reference window paired beside it too (AttachmentSpec decision 8)
      e.preventDefault();
      const p = sources.following;
      const together = !!p && !p.collapsed && papers.besideOf(p);
      sources.toggle(selected());
      if (together && !sources.following) papers.win.close();
    } else if (e.key === "Escape") {
      // what passes first: a question about trust, a popover, the views menu or the focus's, a list
      // of the Time Machine; then the source window that follows the selection, the timeline, the
      // Time Machine, and the selection. A pinned window closes by Esc with the focus in it, or by
      // its ✕.
      if (trust.open) trust.close();
      else if (buildPop.open) buildPop.toggle(false);
      else if (tabs.open) tabs.toggle(false);
      else if (focusMenu.open) focusMenu.toggle(false);
      else if (boardPop.open || trustPop.open || eyesPop.open) for (const p of [boardPop, trustPop, eyesPop]) p.toggle(false);
      else if (tm.listShown) tm.closeListNow();
      else if (sources.following) sources.close(sources.following);
      else if (activity.open) activity.toggle(false);
      else if (lostDrawer.open) lostDrawer.toggle(false);
      else if (tm.active) void tm.close();
      else if (picks.length || shown) {
        clear();
        commit();
      }
    } else if (e.key === "f") canvas.fit();
    else if (e.key === "+" || e.key === "=") canvas.zoomBy(1.6);
    else if (e.key === "-" || e.key === "_") canvas.zoomBy(1 / 1.6);
    else if (e.key === "e") toggleOutside();
    else if (e.key === "g") edgesBtn.click();
    else if (e.key === "o") linear.toggle();
    else if (e.key === "c") chooseScheme(ownScheme() === "kind" ? "status" : "kind");
    else if (e.key === "l") toggleLock();
    else if (e.key === "[") canvas.stepLevels(-1);
    else if (e.key === "]") canvas.stepLevels(1);
    else if (e.key === "p") {
      // a frame meter, to check the canvas keeps up on this machine
      const m = $("#meter");
      m.hidden = !m.hidden;
      if (!m.hidden) {
        const tick = () => {
          if (m.hidden) return;
          const st = canvas.stats();
          m.textContent = `${st.fps} fps · draw ${st.drawMs} ms · ${st.dots} dots · ${st.circles} circles · ${st.bundles} bundles${st.awake ? " · moving" : ""}`;
          setTimeout(tick, 250);
        };
        tick();
      }
    }
    else if (e.key === "b" && !data.snapshot) pill.click();
    // the Time Machine (HistorySpec decisions 15–19): t opens it on the view on show — at the build
    // the view is kept at, else the latest — and leaves it; ← and → step from build to build, Home
    // and End go to the first and the last
    else if (e.key === "t" && !data.snapshot && !e.altKey) {
      if (tm.active) void tm.close();
      else void openTimeMachine(nav.board.rec.version !== undefined ? { snapshot: nav.board.rec.version } : {});
    } else if (tm.active && !e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      tm.step(e.key === "ArrowLeft" ? -1 : 1);
      didTip("first-time-machine");
    } else if (tm.active && (e.key === "Home" || e.key === "End")) {
      e.preventDefault();
      tm.end(e.key === "End");
    }
    else if ((e.key === "a" || e.key === "m") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
      // the review: approve or comment on the selection, as the buttons in the source window that
      // follows it if that is open, else the panel's (a comment not yet written focuses the box: the
      // key is not typed into it). A comment is m: c is the colour scheme's, and m is a comment's
      // key in Jira, and with Ctrl+Alt in Word and Google Docs. There is no key to walk a review (the
      // owner's decision of 2026-10-12): people go from name to name in the source window.
      e.preventDefault();
      const i = selected();
      const f = sources.following;
      // a past build is not reviewed: said where the key was pressed, as the review box says it
      if (i !== null && pastShown()) say(PAST_REVIEW);
      else if (i !== null) reviewBox.give(e.key === "a" ? "approve" : "comment", i, f && !f.collapsed ? f.el : $("#panel"));
    }
    else if (e.key === "k" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) toggleKey();
    else if (e.key === "?") guide.toggleMenu();
  });

  // a handle for diagnosis from the console: window.visualproof.canvas
  // and the Time Machine's hook, as the build-status popover and the lost-and-found call it
  (window as unknown as { visualproof: object }).visualproof = { canvas, linear, graph: () => g, present: () => present, board: () => nav.board, views, tm, timeMachine: (at?: TimeMachineAt) => openTimeMachine(at) };
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
  listen();
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
    history.replaceState({ n: 0 }, "", "#" + encodeState(current()));
  } catch {
    // see writeAddress
  }
  renderNav();
  people.renderMe();
  reviewChanged();
  renderBuild();
  // the source windows the page had before it reloaded into its server's new version, on the
  // declarations found by name (web/src/reload.ts)
  if (kept && (kept.sources.following || kept.sources.pinned.length)) {
    const on = (w: { name: string; collapsed: boolean }) => {
      const decl = present.byName.get(w.name);
      return decl === undefined ? null : { decl, collapsed: w.collapsed };
    };
    const f = kept.sources.following && on(kept.sources.following);
    sources.mirror({ following: f, pinned: kept.sources.pinned.map(on).filter((w) => w !== null) });
    sources.release();
  }
  $("#loader").classList.add("gone");
  // faded out, it leaves the page: a screen reader would read "Reading the project…" at its end
  setTimeout(() => ($("#loader").hidden = true), 450);
  // the guide (GuideSpec): the tour on a first visit, the ? sheet at any time, its tips; tips in place
  /** The tour's and Show me's own moves (GuideSpec decisions 3 and 7): a theorem selected, a tool
   *  chosen, as a click and a mode's button would, but without a step in the history each, and
   *  without anything a tip in place counts as the reader's doing. */
  const tourSelect = (i: number) => {
    if (selected() !== i) {
      if (toView(i) < 0) visitOn(i, selected());
      const p = pickDecl(g.nodes[i].name);
      picks = [p];
      shown = shownOf(p);
      apply();
    }
    reveal(i);
    // with reduced motion nothing in the tour glides (GuideSpec decision 4): the camera is there at once
    if (reducedMotion()) canvas.arrive();
  };
  const tourTool = (m: Tool) => {
    if (m === S.mode) return;
    S.mode = m;
    if (restsOn(m)) S.restsOn = m;
    syncTool();
    const r = retool(picks, shown, m, (root) => keysFor(root));
    if (r.picks === picks) return;
    picks = r.picks;
    shown = r.shown;
    apply();
  };
  /** Where the reader is when the tour begins, put back when it ends (GuideSpec decision 3): the
   *  tool and the step of Rests on a 2 resumes, the selection, the visitors, the camera; the address
   *  as it was, so that the tour leaves no step in the history. */
  interface TourPlace {
    mode: Tool;
    restsOn: Tool | undefined;
    picks: Pick[];
    shown: Shown | null;
    visitors: Visitor[];
    cam: { x: number; y: number; k: number };
  }
  const tourPlace = (): TourPlace => ({ mode: S.mode, restsOn: S.restsOn, picks, shown, visitors, cam: { ...canvas.cam } });
  const tourBack = (p: TourPlace) => {
    S.mode = p.mode;
    S.restsOn = p.restsOn;
    store.save();
    syncTool();
    picks = p.picks;
    shown = p.shown;
    visitors = p.visitors;
    apply();
    if (reducedMotion()) canvas.jumpTo(p.cam);
    else canvas.glideTo(p.cam, 450);
    writeAddress(false);
  };
  /** What Keys lights beside declaration `name` on the board on show, as the tour's Keys view counts
   *  it: the key declarations of the review's focus here, else the target's own. */
  const keysLit = (name: string): number => {
    const q = selectionQuery([declPick("keys", name, keysFor({ decl: name }))]);
    return q ? Math.max(0, litOn(q).count - 1) : 0;
  };
  /** The declaration the tour shows things on (GuideSpec decision 3): the selection; a target whose
   *  Keys view lights key declarations, else a target; else a theorem whose TCB is worth a look and
   *  not a wall, one whose proofs use more than its statement first, so that the TCB leaves
   *  something out. */
  const findExample = (): number | null => {
    if (selected() !== null) return selected();
    const targets = Object.keys(review.data.targets)
      .map((n) => g.byName.get(n))
      .filter((i): i is number => i !== undefined);
    const keyed = targets.find((i) => keysLit(g.nodes[i].name) > 0);
    if (keyed !== undefined) return keyed;
    if (targets.length) return targets[0];
    let fallback: number | null = null;
    let tries = 0;
    for (let i = 0; i < g.projectCount && tries < 400; i++) {
      if (g.nodes[i].kind !== "theorem") continue;
      tries++;
      let n = 0, u = 0;
      const tcb = g.reach([i], SITE_STMT | SITE_BODY, "out");
      for (let j = 0; j < g.projectCount; j++) n += tcb[j];
      if (n < 6 || n > 300) continue;
      const uses = g.reach([i], SITE_STMT | SITE_BODY | SITE_PROOF | SITE_GRAMMAR, "out");
      for (let j = 0; j < g.projectCount; j++) u += uses[j];
      if (u > n) return i;
      fallback ??= i;
    }
    return fallback;
  };
  /** The same, found once for a graph, a board, a revision of the review and a selection: the
   *  sheet asks it of each card, at each key typed in its filter. */
  let exampleOf: { key: unknown[]; i: number | null } | null = null;
  const tourExample = (): number | null => {
    const key = [g, nav.board, review.epoch, review.rev, selected()];
    if (exampleOf && exampleOf.key.every((x, k) => x === key[k])) return exampleOf.i;
    const i = findExample();
    exampleOf = { key, i };
    return i;
  };
  /** What the tour's TCB step says of declaration `i` (GuideSpec decision 2): what each of its
   *  views lights on the board on show, as the selection bar counts it, the theorem apart; what is
   *  lit split, as the bar splits it, into what is to be read and what is trusted (a prefix the
   *  review trusts, a standard axiom: TCBSpec decision 7), and assumed. */
  const restsOnOf = (i: number): RestsOn => {
    const name = g.nodes[i].name;
    const G = vg();
    const d = boardReview();
    const lit = (tool: Tool) => {
      const q = selectionQuery([declPick(tool, name, keysFor({ decl: name }))]);
      return q ? litOn(q).set : null;
    };
    const counts = restsOnCounts(G, d, toView(i), { tcb: lit("tcb"), uses: lit("deps"), keys: lit("keys") });
    return { name: g.nodes[i].display ?? name.split(".").pop()!, ...counts, target: isTarget(name) };
  };
  /** A tip's Show me (GuideSpec decision 7; web/src/tips.ts), done on the reader's own page: the tour's
   *  theorem selected in a mode, a window or a popover opened, the linear form, the Time Machine —
   *  never anything shared, and nothing a tip in place counts as the reader's doing. What to ring
   *  after it, as a phone shows it; null when there is nothing to show here. */
  const showMe = (action: string): string | null => {
    const i = tourExample();
    const phone = isPhone();
    const pick = (m: Tool | null): boolean => {
      if (i === null) return false;
      if (m) tourTool(m);
      tourSelect(i);
      return true;
    };
    switch (action) {
      case "ring-modes":
        return phone ? "#more-btn" : "#lightup";
      case "rests-steps":
        return pick("tcb") ? (phone ? "#more-btn" : "#rests-steps") : null;
      case "used-by": {
        if (i === null) return null;
        // the first of its TCB's definitions besides it, else itself
        const tcb = g.reach([i], SITE_STMT | SITE_BODY, "out");
        let d = i;
        for (let j = 0; j < g.projectCount; j++) if (tcb[j] && j !== i && g.nodes[j].kind === "def") { d = j; break; }
        tourTool("apps");
        tourSelect(d);
        return phone ? "#more-btn" : "#lightup [data-mode=apps]";
      }
      case "open-source":
        if (!pick(null)) return null;
        if (!sources.following) sources.toggle(selected());
        return ".sw-win";
      case "colour-status":
        if (ownScheme() !== "status") chooseScheme("status");
        $("#legend [data-lg-open]")?.click();
        return "#legend";
      case "ring-review":
        return pick(null) ? "#panel .rv" : null;
      case "ring-target":
        return pick(null) ? (phone ? "#panel [data-rv-target]" : "#panel [data-rv-target], #targets") : null;
      case "ring-key":
        // the targets are in ☰ on a phone
        return reviewRoot() !== null && pick(null) ? "#panel [data-rv-key]" : phone ? "#side-btn" : "#targets";
      case "what-changed": {
        const d = $("#panel details[data-rv-changes]") as HTMLDetailsElement | null;
        if (!d) return null;
        d.open = true;
        return "#panel [data-rv-changes]";
      }
      case "ring-trusted":
        return phone ? "#side-btn" : "#trusted-btn";
      case "library-pair":
        return phone ? "#more-btn" : "#library-btn";
      case "ring-lock":
        if (!eyesPop.open) eyesPop.toggle(true);
        return "#lock-btn";
      case "ring-zoom":
        return pick("tcb") ? "#selbar [data-zoom]" : null;
      case "ring-board":
        return phone ? "#side-btn" : "#board-btn";
      case "ring-peers":
        return "#peers";
      // Share, the library and Export are in ⋯ on a phone
      case "ring-share":
      case "share-readonly":
      case "share-agent":
        return phone ? "#more-btn" : "#share-btn";
      case "linear":
        if (!linear.asked) linear.toggle();
        return "#linear";
      case "ring-export":
        return phone ? "#more-btn" : "#export-btn";
      case "time-machine":
        if (!tm.active) void openTimeMachine();
        return "#tmbar";
      case "ring-lost":
        if ($("#build-pop").hidden) $("#build").click();
        return "#build-pop [data-bp=lost]";
    }
    return null;
  };
  /** Whether a Show me has something to show on this page. */
  const canShowMe = (action: string): boolean => {
    if (["rests-steps", "used-by", "open-source", "ring-review", "ring-target", "ring-zoom", "tcb-three"].includes(action)) return tourExample() !== null;
    // what a phone has not: the lock, the linear form (PhoneSpec)
    if (isPhone() && (action === "ring-lock" || action === "linear")) return false;
    if (action === "ring-peers") return !$("#peers").hidden;
    if (action === "what-changed") return !!$("#panel details[data-rv-changes]");
    if (action === "share-readonly") return readOnlyLinks;
    if (action === "share-agent" || action === "ring-lock") return !reader;
    if (action === "time-machine" || action === "ring-lost") return !data.snapshot;
    return true;
  };
  const guide = new Guide(store, {
    project: () => meta.project.name,
    about,
    snapshot: () => !!data.snapshot,
    readOnly: () => !!data.snapshot || !!reader,
    following: () => people.followedName !== null,
    busy: () => !!artLook,
    example: tourExample,
    select: tourSelect,
    setTool: tourTool,
    place: tourPlace,
    back: (p) => tourBack(p as TourPlace),
    // Show me's moves, one step in the history
    record: commit,
    restsOn: restsOnOf,
    frameLit: () => {
      const q = selectionQuery(picks);
      const lit = q && litOn(q);
      if (lit?.count) canvas.fitTo(lit.set, !reducedMotion());
    },
    show: showMe,
    canShow: canShowMe,
    // the read-only link's tip on a server that makes them (web/src/share.ts)
    applies: (t) => t.id !== "read-only-link" || readOnlyLinks,
    ended: () => {},
    editor: () => ({ server: editor.server, mine: editor.mine }),
    setEditor: (t) => {
      const why = editor.set(t);
      // the panel and the source windows show the link, or no longer do
      if (!why) {
        sources.redraw((name) => g.byName.get(name));
        showSelected();
      }
      return why;
    },
    updates: () => (data.snapshot ? Promise.resolve(null) : data.updates()),
    clips: () => (data.snapshot ? Promise.resolve(new Set<string>()) : data.tipClips()),
    // the film in the address while it shows (`tips`), and not once the sheet closes
    shown: (open, chapter) => {
      const part = tipsPart(open, chapter);
      if (part === filmPart) return;
      filmPart = part;
      writeAddress(false);
    },
    tour: () => (data.snapshot ? Promise.resolve(null) : data.tourJson()),
  });
  offerTip = (rule) => guide.inPlace.offer(rule);
  didTip = (rule) => guide.inPlace.did(rule);
  countTip = (name, rule) => guide.inPlace.count(name, rule);
  hearRelease = (v) => guide.serverIs(v);
  if (heardRelease) guide.serverIs(heardRelease);
  if (!data.snapshot && !reader) void data.shareInfo().then((i) => (readOnlyLinks = !!i.readOnlyLinks), () => {});
  // the moments of tips in place that a press makes: Share opened again, Export opened; and what a
  // tip teaches, done — the Read-only link tab opened, What changed opened
  let shareOpened = 0;
  $("#share-btn").addEventListener("click", () =>
    setTimeout(() => {
      if (!$("#share-pop").hidden && ++shareOpened >= 2 && readOnlyLinks) offerTip("share-twice");
    }, 300),
  );
  $("#export-btn").addEventListener("click", () => setTimeout(() => exportModal.isOpen && offerTip("first-export"), 300));
  document.addEventListener(
    "click",
    (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("#share-pop [data-tab=readonly]")) didTip("share-twice");
      else if (t.closest("#panel [data-rv-changes] > summary")) didTip("stale-opinion");
    },
    true,
  );
  void data.activity().then((events) => activity.load(events));
  // who this page is, then the others are told where it is; the camera and the source window
  // change without a step in the history, so they are looked at every second and a half
  void people.init().then(() => {
    people.start();
    // offered, never started by itself (GuideSpec decision 1); a link to the film opens it, at its
    // chapter: the visitor is watching already
    setTimeout(() => {
      guide.welcome(deepLink);
      if (filmLink !== undefined) guide.openHelp("tips", filmLink ? { chapter: filmLink } : {});
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
