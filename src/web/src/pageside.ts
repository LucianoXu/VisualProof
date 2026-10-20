// The side panel: the cluster tree (web/src/outline.ts), and over it ⚙ Board (web/src/boardpanel.ts)
// and Trusted (web/src/trust.ts); and the board on show, shared with everyone on it
// (web/src/boardsync.ts).
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import type { FileStatus } from "../../shared/build.ts";
import { reviewCount } from "../../shared/reviewqueue.ts";
import { BoardPanel } from "./boardpanel.ts";
import { BoardSync } from "./boardsync.ts";
import { escapeHtml } from "./highlight.ts";
import { Outline } from "./outline.ts";
import { besideSide, Popover } from "./popover.ts";
import { clusterOn } from "./selection.ts";
import { SHIELD, Trust } from "./trust.ts";
import { $, STATE_LABEL, PAST_REVIEW, READ_ONLY_REVIEW } from "./page.ts";
import type { Page } from "./page.ts";

/** What the side panel gives the page's other parts. */
export interface SidePart {
  shut: (section: string) => boolean;
  toggleSection: (section: string) => void;
  trust: Trust;
  boardPop: Popover;
  trustPop: Popover;
  renderTrusted: () => void;
  files: () => Map<string, FileStatus>;
  outline: Outline;
  boardPanel: BoardPanel;
  sync: BoardSync;
  hideLevel: (key: string) => void;
  renderHidden: () => void;
}

export function sidePart(page: Page): SidePart {
  const { data, store, reader } = page;

  // the sections a reader folds away: the targets, and the board's filter (folded until the reader
  // opens it)
  const shut = (section: string) => store.isShut(section);
  const toggleSection = (section: string) => {
    store.toggleShut(section);
    if (section === "targets") page.targetList.render();
    else boardPanel.render();
  };

  // what is trusted without review, in a popover from the side panel (web/src/trust.ts)
  const trust = new Trust($("#trust-list"), $("#trust-pop"), {
    review: () => ({ data: page.review.data, blocked: page.blocked(), readOnly: !!data.snapshot || page.pastShown() || !!reader, ...(page.pastShown() ? { note: PAST_REVIEW } : reader ? { note: READ_ONLY_REVIEW } : {}) }),
    graph: () => page.g,
    // each target counts what its review holds under the trust asked about (shared/reviewqueue.ts)
    targets: () =>
      Object.keys(page.review.data.targets)
        .map((name) => ({ name, i: page.g.byName.get(name) }))
        .filter((t): t is { name: string; i: number } => t.i !== undefined)
        .map((t) => ({ name: t.name, count: (d) => reviewCount(page.g, d, t.i) })),
    ensureReviewer: () => page.people.ensure(),
    submit: page.submit,
    show: (p) => page.goToPrefix(p),
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
    const n = page.review.data.trusted.length;
    $("#trusted-btn").innerHTML = `<span class="tl-shield">${SHIELD}</span>Trusted <span class="side-n">${n}</span>`;
    if (trustPop.open) trust.render();
  };

  const files = () => new Map((page.build?.files ?? []).map((f) => [f.module, f]));
  const outline = new Outline($("#outline"), {
    // a row is its cluster: clicked with the tool, and gone to
    select: (c, shift) => {
      if (page.clickOn(page.pickCluster(c), shift) && page.shownCluster() === c) page.canvas.flyToCluster(c);
    },
    picked: (c) => page.picks.some((p) => !!p.root && clusterOn(p.root, page.canvas.layout, page.cm()) === c),
    toggleFold: (c) => page.canvas.toggleFold(c),
    isFolded: (c) => page.canvas.folded.has(c),
    isCollapsed: (c) => page.canvas.isCollapsed(c),
    stateOf: (c) => {
      if (page.pastShown()) return "";
      const f = page.fileIndex.get(page.canvas.layout.clusters[c].key);
      return f && STATE_LABEL[f.state] ? `st-${f.state}` : "";
    },
    trustCell: (c) => trust.cell(page.canvas.layout.clusters[c], page.cm()),
    trustClicked: (c, row) => trust.clicked(page.canvas.layout.clusters[c], page.cm(), row),
    hide: (c) => hideLevel(page.canvas.layout.clusters[c].key),
  });
  page.fileIndex = files();

  // the board's settings, in the ⚙ Board popover: its scope as chips (web/src/boardpanel.ts)
  const boardPanel: BoardPanel = new BoardPanel($("#board"), $("#board-note"), {
    view: () => {
      const b = page.nav.board;
      if (!b) return null;
      let own = 0;
      for (let i = 0; i < page.g.projectCount; i++) own += b.bs.set[i];
      return { rec: b.rec, title: page.views.title(b.id), own, outside: b.bs.count - own };
    },
    setScope: (q): Promise<string | null> => sync.setScope(q),
    snapshot: () => !!data.snapshot,
    shut,
    toggle: toggleSection,
  });

  // the board on show, shared: this page's changes out, the others' in (web/src/boardsync.ts)
  const sync: BoardSync = new BoardSync(page.views, page.nav, {
    canvas: page.canvas,
    outline,
    boardPanel,
    notes: page.notes,
    snapshot: !!data.snapshot,
    stream: () => page.people.stream,
    me: () => page.people.name,
    colorOf: (name) => page.people.colorOf({ name }),
    lost: () => page.people.lost(),
    tabsChanged: () => page.renderTabs(),
    notesChanged: () => page.stickies.render(),
    boardChanged: () => page.linear.refresh(),
    levelChanged: () => page.showLevel(),
    activityChanged: () => page.activity.changed(),
    hint: (text) => page.say(text),
    writeAddress: (push) => page.writeAddress(push),
    // a preview of the view at another build is arranged by nobody here (web/src/views.ts); a view
    // kept at a past build is arranged as any (the owner's decision of 2026-10-10)
    frozen: () => (page.frozen() ? page.frozenWhy() : null),
    // the view's own focus, or its link, changed: the review follows where the focus in force did
    focusChanged: () => {
      const was = page.focusWas;
      page.syncFocus();
      if (page.focusWas !== was) page.apply();
    },
    // a target linked elsewhere, or its view deleted: its panel says so
    linksChanged: () => page.showSelected(),
  });

  /** Hide a level of the board on show by its cluster's key, for everyone on it (ViewSpec decision
   *  24): the outline's rows, a cluster's panel and the canvas's menu call it. */
  const hideLevel = (key: string) => void sync.hideLevel(key);
  /** The levels the board on show hides, in ⚙ Board: how many, Show all, and each with Show. */
  const renderHidden = () => {
    const keys = page.nav.board?.rec.hidden[page.cm()] ?? [];
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
    if (t.closest("[data-show-all]")) void sync.setHidden([...page.nav.board.rec.hidden[page.cm()]], false);
  });

  return { shut, toggleSection, trust, boardPop, trustPop, renderTrusted, files, outline, boardPanel, sync, hideLevel, renderHidden };
}
