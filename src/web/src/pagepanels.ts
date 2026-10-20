// What tells of the selection: the declaration's panel and a cluster's, the selection bar, the
// library's reference window (AttachmentSpec.md, web/src/paperlinks.ts), the source windows
// (ReviewSpec, "The source window"; web/src/sources.ts), and the panel shown for what was last
// clicked.
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import { ClusterPanel } from "./clusterpanel.ts";
import { escapeHtml } from "./highlight.ts";
import { Panel } from "./panel.ts";
import { READ_ONLY } from "./people.ts";
import { githubBlob } from "../../shared/deploy.ts";
import { SelectionBar } from "./selbar.ts";
import { clusterIndex, remove, shownOf } from "./selection.ts";
import { SourceWindow, sourceMemory } from "./sourcewin.ts";
import type { SourceHooks } from "./sourcewin.ts";
import { Sources } from "./sources.ts";
import { pairTop } from "./paperdock.ts";
import { Papers } from "./paperlinks.ts";
import { clusterSubject, PAST_LINK } from "../../shared/library.ts";
import { buildWhen } from "./timemachine.ts";
import { PAST_CHANGED, PAST_GHOST, PAST_RENAMED } from "./past.ts";
import { $, STATE_LABEL } from "./page.ts";
import type { Page } from "./page.ts";

/** What the panels give the page's other parts. */
export interface PanelsPart {
  selected: () => number | null;
  papers: Papers;
  panel: Panel;
  clusterPanel: ClusterPanel;
  selBar: SelectionBar;
  sources: Sources<SourceWindow>;
  openSourceAt: (name: string, from: number, to: number, quoted: string[] | null, at: HTMLElement | null) => void;
  shownCluster: () => number;
  showSelected: () => void;
}

export function panelsPart(page: Page): PanelsPart {
  const { data, store, S, reader, editor } = page;

  /** the declaration the panel tells of, in the whole graph's numbering, or null */
  const selected = (): number | null => (page.shown && "decl" in page.shown ? page.g.byName.get(page.shown.decl) ?? null : null);

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
  $("#panel").addEventListener("scroll", () => page.canvas.request(), { passive: true });

  // the library and the reference window (AttachmentSpec.md; web/src/paperlinks.ts): the links a panel
  // lists, the pairing with the source window, the window shown to those who follow
  const papers: Papers = new Papers($("#windows"), $("#library-btn"), $("#library-pop"), $("#panel"), {
    review: () => page.boardReview(),
    takeChange: (c) => page.takeChange(c),
    graph: () => page.g,
    clustering: () => page.cm(),
    boardSubject: () => (page.shown && "decl" in page.shown ? `decl(${page.shown.decl})` : page.shown && "cluster" in page.shown ? clusterSubject(page.shown.cluster, page.cm()) : null),
    // a past build is not reviewed, and links are part of the review (ViewSpec decision 26)
    cannotLink: () => (data.snapshot ? "A snapshot of the page shows the links as they were: they are made on the server." : reader ? READ_ONLY : page.pastShown() ? PAST_LINK : null),
    goDecl: (name) => {
      const i = page.g.byName.get(name) ?? page.g.foldedInto.get(name);
      if (i === undefined) page.say(`${name} is not in the graph on show.`);
      else page.go(i);
    },
    goCluster: (kind, key) => {
      if ((kind === "file") !== (page.cm() === "module")) return page.say(`${key} is a cluster by ${kind === "file" ? "file" : "namespace"}: this board is clustered by ${page.cm() === "module" ? "file" : "namespace"}.`);
      const c = clusterIndex(page.canvas.layout, key);
      if (c < 0) page.say(`${key} is not a cluster of this board.`);
      else page.goCluster(c);
    },
    headers: () => ({ "content-type": "application/json", ...(data.name ? { "x-visualproof-name": encodeURIComponent(data.name) } : {}), ...(data.privateSession ? { "x-visualproof-private": data.privateSession } : {}) }),
    ensureName: async () => (await page.people.ensure()) !== null,
    following: () => page.people.followedName,
    changed: () => page.people.report(),
    say: (text) => page.say(text),
    relayoutSource: () => sources.following?.relayout(),
    repaint: () => showSelected(),
    readOnly: () => (data.snapshot ? "A snapshot of the page carries no library: its files are on the server." : reader ? READ_ONLY : null),
    noFiles: () => (data.snapshot ? "A snapshot of the page carries the library's records and links, not its files: open it on the server." : null),
    // what notes carry (AttachmentSpec decision 12): a clip made into a note, a file attached to one
    cannotNote: () => page.noteRefused(),
    clip: (c, text) => page.clipToNote(c, text),
    attach: (note, c) => page.attachTo(note, c),
  });

  const panel = new Panel($("#panel"), page.g, page.reviewBox, {
    links: (i) => papers.declHtml(i),
    go: (i) => page.go(i),
    walk: (i) => page.walk(i),
    reviewData: () => page.boardReview(),
    openSource: (i) => void sources.show(i),
    preview: (i) => page.canvas.preview(i === null || page.toView(i) < 0 ? null : page.toView(i)),
    unpin: (i) => {
      if (page.toView(i) < 0) return;
      page.canvas.unpin(page.toView(i));
      page.sync.sharePins();
    },
    isPinned: (i) => !page.frozen() && page.toView(i) >= 0 && page.canvas.isPinned(page.toView(i)),
    close: () => {
      page.clear();
      page.commit();
    },
    // a past build's files are not the build status of now
    fileOf: (i) => (page.pastShown() ? undefined : page.fileIndex.get(page.g.nodes[i].module)),
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
      const r = page.reviewRoot();
      return r === null ? "" : page.flow.whyHtml(r, i);
    },
    queue: (i, keyOnly) => (page.flow.isTarget(i) ? page.flow.listHtml(i, keyOnly) : null),
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
    const past = page.nav.board?.past?.past;
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
    board: () => ({ graph: page.vg(), layout: page.canvas.layout, mode: page.cm(), toFull: page.toFull }),
    reviewData: () => page.boardReview(),
    isFolded: (c) => page.canvas.folded.has(c),
    toggleFold: (c) => page.canvas.toggleFold(c),
    goCluster: (c) => page.goCluster(c),
    go: (i) => page.go(i),
    preview: (i) => page.canvas.preview(i === null || page.toView(i) < 0 ? null : page.toView(i)),
    previewCluster: (c) => page.canvas.previewCluster(c),
    zoom: (c) => void page.zoomCluster(c),
    canZoom: (c) => !reader && page.clusterScope(c) !== null,
    hide: (c) => page.hideLevel(page.canvas.layout.clusters[c].key),
    trust: (c) => page.trust.state(page.canvas.layout.clusters[c], page.cm()),
    trustClicked: (c, anchor) => page.trust.clicked(page.canvas.layout.clusters[c], page.cm(), anchor),
    // a past build's files are not the build status of now, and its modules are its graph's
    fileOf: (m) => (page.pastShown() ? undefined : page.fileIndex.get(m)),
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
    names: () => page.views.titles().names ?? undefined,
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
      const m = page.keyMarking();
      if (m) void page.reviewBox.markKeys(m.names).then((why) => why && page.say(why));
    },
  });

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
    fileOf: (m) => (page.pastShown() ? undefined : page.fileIndex.get(m)),
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
    say: (text) => page.say(text),
    pastOf: (G) => {
      const past = page.nav.board?.past?.past;
      return past && past.graph === G ? { past, when: buildWhen(past.snapshot.at) } : null;
    },
    // the reference window paired with a source window stands beside it, on the right of the two
    docked: (w) => papers.dockFor(w),
  };
  const memory = sourceMemory();
  const sources: Sources<SourceWindow> = new Sources({
    make: () => new SourceWindow($("#windows"), page.g, data, page.reviewBox, sourceHooks, memory),
    say: (text) => page.say(text),
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

  /** Open declaration `name`'s source at lines `from`–`to` of its file (a code quote's header in a
   *  comment, clicked in `at`; ReviewSpec, "Comments"): in a window that shows it already — the one
   *  clicked in, else any — and else in the following window, the declaration gone to first; the
   *  lines are scrolled to and flashed there. */
  const openSourceAt = (name: string, from: number, to: number, quoted: string[] | null, at: HTMLElement | null) => {
    const j = page.g.byName.get(name) ?? page.g.foldedInto.get(name);
    if (j === undefined) return page.say(`${name} is not in the graph now.`);
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
  const shownCluster = (): number => (page.shown && "cluster" in page.shown && page.canvas.layout ? clusterIndex(page.canvas.layout, page.shown.cluster) : -1);

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
      page.canvas.setLead({ kind: "cluster", c }, leadEnd);
      return;
    }
    clusterPanel.hide();
    const i = selected();
    panel.show(i);
    sources.follow(i);
    sources.redrawReviews();
    const k = i === null ? -1 : page.visitorOf(i);
    page.canvas.setLead(i !== null && page.toView(i) >= 0 ? { kind: "node", i: page.toView(i) } : k >= 0 ? { kind: "visitor", k } : null, leadEnd);
    // an opinion given on an earlier version, its What changed closed (web/src/tips.ts, stale-opinion)
    if ($("#panel details[data-rv-changes]:not([open])")) page.offerTip("stale-opinion");
    if (i !== null && page.editedNow(i) === null && !page.pastShown())
      void page.edited(i).then((e) => {
        if ((e || page.reviewBox.needsSource(i)) && selected() === i && !page.pastShown()) {
          panel.show(i);
          sources.follow(i);
        }
      });
  };

  return { selected, papers, panel, clusterPanel, selBar, sources, openSourceAt, shownCluster, showSelected };
}
