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

import { emptyReview } from "../../shared/review.ts";
import { PROJECT } from "../../shared/views.ts";
import { dataSource } from "./data.ts";
import type { DataSource, ReviewState } from "./data.ts";
import { Graph } from "../../shared/viewgraph.ts";
import { deployWaiting } from "./buildpop.ts";
import { Editor } from "./editor.ts";
import { keptFocus } from "./focus.ts";
import { takeKept } from "./reload.ts";
import type { Kept } from "./reload.ts";
import { snapshotIn } from "../../shared/sharesnap.ts";
import { recipeIn } from "../../shared/artrecipe.ts";
import { noteIn, siteOrigins } from "./chatlinks.ts";
import { decodeState, encodeState, tipsIn } from "./state.ts";
import { Store } from "./store.ts";
import type { Place } from "./viewnav.ts";
import type { TimeMachineAt } from "./timemachine.ts";
import { $, VIEW_GONE } from "./page.ts";
import type { GraphInfo, Page } from "./page.ts";
import { viewsPart } from "./pageviews.ts";
import { reviewPart } from "./pagereview.ts";
import { panelsPart } from "./pagepanels.ts";
import { boardPart } from "./pageboard.ts";
import { artPart } from "./pageart.ts";
import { sidePart } from "./pageside.ts";
import { layoutPart } from "./pagelayout.ts";
import { schemePart } from "./pagescheme.ts";
import { followPart } from "./pagefollow.ts";
import { talkPart } from "./pagetalk.ts";
import { peoplePart } from "./pagepeople.ts";
import { pointerPart } from "./pagepointer.ts";
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
  Object.assign(page, await viewsPart(page));
  Object.assign(page, reviewPart(page));
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
    const v = await page.views.open(linked.scope, { version: linked.version ?? null });
    if (typeof v !== "string") first = v.id;
    else notOpened = `This link's view could not be opened: ${v}`;
  }
  Object.assign(page, boardPart(page));
  Object.assign(page, artPart(page));
  Object.assign(page, sidePart(page));
  Object.assign(page, layoutPart(page));
  Object.assign(page, schemePart(page));
  Object.assign(page, followPart(page));
  Object.assign(page, talkPart(page));
  Object.assign(page, peoplePart(page));
  Object.assign(page, pointerPart(page));
  Object.assign(page, tabsPart(page));
  Object.assign(page, sharePart(page));
  Object.assign(page, timelinePart(page));
  Object.assign(page, selectionPart(page));
  Object.assign(page, addressPart(page));
  Object.assign(page, livePart(page));
  Object.assign(page, toolbarPart(page));
  Object.assign(page, menuPart(page));
  Object.assign(page, notesPart(page));
  Object.assign(page, keysPart(page));
  // the conversation window left open by the reader, open again now that every part is made: its
  // thread is drawn with who the reader is (web/src/pagetalk.ts)
  page.reopenTalk();

  // a handle for diagnosis from the console: window.visualproof.canvas
  // and the Time Machine's hook, as the build-status popover and the lost-and-found call it
  (window as unknown as { visualproof: object }).visualproof = { canvas: page.canvas, linear: page.linear, graph: () => page.g, present: () => page.present, board: () => page.nav.board, views: page.views, tm: page.tm, timeMachine: (at?: TimeMachineAt) => page.openTimeMachine(at) };
  window.addEventListener("resize", page.syncInsets);
  // the first view, and the place the link names on it (or where the reader was); a tab of a view
  // the server forgot opens again from its query
  // the reader's own focus there, which the address does not carry, as they left it (ViewSpec
  // decision 28)
  const firstPlace: Place | null = linked ? { mode: linked.mode, picks: linked.picks, shown: linked.shown, cam: null, ...keptFocus(S.seen[first]) } : null;
  if (!(await page.nav.select(first, firstPlace))) {
    await page.nav.show(PROJECT, firstPlace);
    if (linked?.view && linked.view === first && !page.views.summary(first)) notOpened = VIEW_GONE;
  }
  page.listen();
  if (notOpened) page.say(notOpened);
  // a link with a snapshot of what its sharer saw: applied once, on the board its address opened
  const snap = snapshotIn(location.hash);
  if (snap) await page.openSnapshot(snap);
  // a link to a note (Copy link, CollabSpec decision 13): the note shown, on the board it opened
  const noteLink = noteIn(location.hash);
  if (noteLink) page.showNote(noteLink.ofView ? page.nav.board.id : "", noteLink.id);
  // the reader came to a place (a declaration, a view, what a sharer saw, an artwork): the welcome
  // stays quiet (GuideSpec decision 1)
  const deepLink = filmLink !== undefined || !!snap || !!noteLink || !!recipeIn(location.hash) || (!!linked && (!!linked.picks || !!linked.shown || (linked.view !== null && linked.view !== PROJECT) || !!linked.scope));
  // a link with an artwork's recipe (ExportSpec decision 20): once, after the board is there; the
  // files it asks for are saved meanwhile
  const recipe = recipeIn(location.hash);
  if (recipe) void page.openRecipe(recipe);
  // the builds the history holds: the clocks of views kept at one say which
  if (!data.snapshot) void page.tm.load().then(() => page.renderTabs());
  try {
    history.replaceState({ n: 0 }, "", "#" + encodeState(page.current()));
  } catch {
    // see writeAddress
  }
  page.renderNav();
  page.people.renderMe();
  page.reviewChanged();
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
