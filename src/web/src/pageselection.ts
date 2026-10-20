// What is selected (web/src/selection.ts): a click with the tool and what it lights up, the tool
// itself, the visitors (ViewSpec decision 27), going to a declaration, a cluster, a file or a place,
// Zoom in; and the selection following a rename.
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import type { Lit } from "../../shared/board.ts";
import { printQuery } from "../../shared/query.ts";
import { litKeyEdges } from "../../shared/keys.ts";
import type { Query } from "../../shared/query.ts";
import { covers } from "../../shared/review.ts";
import { trustSplit } from "../../shared/reviewqueue.ts";
import type { VisitorPoint } from "./canvas.ts";
import { ringed } from "./axiomring.ts";
import type { LitCount } from "./selbar.ts";
import { click, clusterOn, clusterSet, edgeMode, followRenames, pickWords, readSelection, restsOn, retool, sameShown, selectionQuery, selectionText, shownOf, TOOLS } from "./selection.ts";
import type { Pick, Tool } from "./selection.ts";
import { clusterPrefix } from "./trust.ts";
import { stillVisiting, visit, visitorEdges } from "./visitors.ts";
import type { Place } from "./viewnav.ts";
import { $ } from "./page.ts";
import type { Page } from "./page.ts";

/** What the selection gives the page's other parts. */
export interface SelectionPart {
  followSelection: () => boolean;
  newBuild: (from: number, to: number) => Promise<void>;
  selectionFollowed: () => void;
  renderSelBar: (q?: Query | null, lit?: Lit | null) => void;
  apply: () => void;
  syncTool: () => void;
  clickOn: (p: Pick, shift: boolean) => boolean;
  useTool: (m: Tool) => void;
  readerMode: (m: Tool) => void;
  clear: () => void;
  visitorOf: (i: number) => number;
  visitOn: (i: number, from: number | null) => void;
  drawVisitors: () => void;
  reveal: (i: number) => void;
  revealShown: () => void;
  go: (i: number) => void;
  goCluster: (c: number) => void;
  goName: (name: string) => boolean;
  place: (p: Place, fresh: boolean) => void;
  here: () => Place;
  zoomIn: () => Promise<void>;
  clusterScope: (c: number) => Query | null;
  zoomCluster: (c: number) => Promise<void>;
  goToModule: (m: string) => void;
  goToPrefix: (p: string) => void;
}

export function selectionPart(page: Page): SelectionPart {
  const { store, S } = page;

  /** What the reader selected follows a rename of it (web/src/selection.ts, followRenames): a build
   *  that renamed it, or a move that says so, which may come before or after the new graph. True
   *  where it did; the board is drawn again by the caller. */
  const followSelection = (): boolean => {
    // the renames in force, and those the builds read since the page opened found of declarations
    // nothing was said of, which are in the history alone (HistorySpec decision 10)
    const renamed: Record<string, string> = Object.assign(Object.create(null), page.review.data.renamed);
    for (const [from, to] of buildRenames) if (!Object.hasOwn(renamed, to)) renamed[to] = from;
    const r = followRenames(page.picks, page.shown, renamed, (name) => page.present.byName.has(name));
    if (r.picks === page.picks && r.shown === page.shown) return false;
    ({ picks: page.picks, shown: page.shown } = r);
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
    page.writeAddress(false);
    page.people.report();
  };

  /** How many are lit on the board as the selection bar counts them: what is not trusted, the
   *  trusted apart (TCBSpec decision 7, ViewSpec decision 14). */
  const litCount = (lit: Lit | null): LitCount => (lit ? trustSplit(page.vg(), page.boardReview(), lit.set) : { counted: 0, trusted: 0 });
  /** The selection bar: its picks, what is lit, Zoom in, and where the review has a focus what "Mark
   *  selected as key" would mark — which the review changes, so it is drawn again with it. */
  const renderSelBar = (q = selectionQuery(page.picks), lit: Lit | null = q && page.litOn(q)) =>
    page.selBar.render(page.picks, page.picks.findIndex((p) => !!page.shown && sameShown(shownOf(p), page.shown)), litCount(lit), page.zoomOf(q, lit) !== null, page.keyMarking());

  /** What is selected, lit and shown: the selection's query evaluated on the whole graph and cut to
   *  the board (decided 2026-10-07: what is lit is exactly that set; the owner's decision,
   *  2026-10-08: on the whole graph, so that a path through what the board leaves out counts), the
   *  rings on its picks' roots, the panel, the selection bar. */
  const apply = () => {
    const G = page.vg();
    page.syncFocus();
    const q = selectionQuery(page.picks);
    const lit = q && page.litOn(q);
    // under Keys, the key graph's edges among what is lit instead of the references among it
    const keyEdges = S.mode === "keys" && lit && lit.count ? keyEdgesOn(lit) : null;
    // the picks' roots, on this board: declarations, and clusters of its clustering
    const decls: number[] = [], clusters: number[] = [];
    for (const p of page.picks) {
      if (!p.root) continue;
      if ("decl" in p.root) {
        const j = G.byName.get(p.root.decl);
        if (j !== undefined) decls.push(j);
      } else {
        const c = clusterOn(p.root, page.canvas.layout, page.cm());
        if (c >= 0) clusters.push(c);
      }
    }
    // an artwork's look (ExportSpec decision 19): its targets alone, the rest faded; or nothing of the
    // selection, which stays the reader's
    if (page.artLook?.targets === "highlight") {
      const alone = new Uint8Array(G.n);
      for (let i = 0; i < G.n; i++) if (page.canvas.isTarget(i)) alone[i] = 1;
      page.canvas.setActivation(edgeMode(page.picks), [], alone, [], null);
    } else if (page.artLook && !page.artLook.selection) page.canvas.setActivation(edgeMode(page.picks), [], null, [], null);
    else page.canvas.setActivation(edgeMode(page.picks), decls, lit?.set ?? null, clusters, keyEdges);
    page.linear.request();
    drawVisitors();
    renderSelBar(q, lit);
    syncTool();
    page.showSelected();
    page.outline.render();
    page.renderStrip();
    page.syncInsets();
  };

  /** The key graph's edges among what is lit (shared/keys.ts, litKeyEdges), as pairs in the board's
   *  numbering: where the review has a focus its target's key graph, elsewhere every target's — the
   *  union over the targets whose key declarations are lit. */
  const keyEdgesOn = (lit: Lit): number[] => {
    const r = page.reviewRoot();
    const roots = r !== null ? [r] : Object.keys(page.review.data.targets).map((n) => page.g.byName.get(n)).filter((i): i is number => i !== undefined);
    const on = (i: number) => {
      const j = page.toView(i);
      return j >= 0 && lit.set[j] === 1;
    };
    return litKeyEdges(roots.map((t) => page.flow.keys(t)), on).flatMap(([a, b]) => [page.toView(a), page.toView(b)]);
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
      page.legend.render();
    }
  };

  /** What a query lights up on the board, for what a click covers (web/src/selection.ts). */
  const setOn = (q: Query) => page.litOn(q).set;

  /** A click with the tool (web/src/selection.ts, click): the selection becomes that pick, or with
   *  shift under Selection that one pick goes in or out; one step in the history. False when it
   *  changed nothing: a picked cluster covers it already, which the hint says. */
  const clickOn = (p: Pick, shift: boolean): boolean => {
    const r = click(page.picks, page.shown, p, shift, setOn);
    if (r.covered) {
      const names = page.views.titles().names ?? undefined;
      page.say(`${pickWords(p, names)} is inside ${pickWords(r.covered, names)}, which is selected: nothing changed.`);
      return false;
    }
    const before = page.picks.length;
    page.picks = r.picks;
    page.shown = r.shown;
    apply();
    page.commit();
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
      if (shift) return page.didTip("selection-replace");
      if (!decl || !before) return;
      const now = Date.now();
      replaced = [...replaced.filter((t) => now - t < 20_000), now];
      if (replaced.length >= 3) page.offerTip("selection-replace");
    } else if (S.mode === "tcb" && decl) {
      const i = page.g.byName.get(decl);
      const q = selectionQuery(page.picks);
      if (i !== undefined && page.g.nodes[i].kind === "theorem" && q && page.litOn(q).count > 1) page.offerTip("tcb-first");
      if (page.countTip("tcb-picks", "rests-only-tcb") >= 5) page.offerTip("rests-only-tcb");
    }
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
    const r = retool(page.picks, page.shown, m, (root) => page.keysFor(root));
    if (r.picks === page.picks) return page.writeAddress(false);
    page.picks = r.picks;
    page.shown = r.shown;
    apply();
    page.commit();
  };

  /** The tool chosen by the reader, by a mode's button or key: another step of Rests on than TCB
   *  is what two tips in place teach (web/src/tips.ts, tcb-first and rests-only-tcb) — the tour and
   *  Show me choose it otherwise, and teach nothing of it. */
  const readerMode = (m: Tool) => {
    if (m === "keys" || m === "deps" || m === "refs") {
      page.didTip("tcb-first");
      page.didTip("rests-only-tcb");
    }
    setMode(m);
  };

  /** Nothing selected; the visitors go with the selection (ViewSpec decision 27). */
  const clear = () => {
    page.picks = [];
    page.shown = null;
    page.visitors = [];
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
    const name = page.g.nodes[i]?.name;
    return name === undefined ? -1 : page.visitors.findIndex((v) => v.name === name);
  };
  /** Declaration `i`, which the board does not hold, a visitor on it, the newest of the trail,
   *  reached from `from` where that is on the board or a visitor. Its place is the canvas's to choose
   *  (drawVisitors); one that is a visitor already keeps its own. */
  const visitOn = (i: number, from: number | null) => {
    const reached = from !== null && from !== i && (page.toView(from) >= 0 || visitorOf(from) >= 0);
    page.visitors = visit(page.visitors, { name: page.g.nodes[i].name, from: reached ? page.g.nodes[from!].name : null, place: null });
  };
  /** What the board does not hold of where the reader is — the selection's declarations and what the
   *  panel tells of — made visitors where they are not yet (a link, a tab come back to, an agent
   *  followed, which says nothing of visitors). True where one was made. */
  const ensureVisitors = (): boolean => {
    const want = new Set(page.clickedDecls());
    const i = page.selected();
    if (i !== null) want.add(i);
    let made = false;
    for (const j of want) {
      if (page.toView(j) >= 0 || visitorOf(j) >= 0) continue;
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
    page.visitors = stillVisiting(page.visitors, (n) => {
      const i = page.g.byName.get(n);
      return i !== undefined && page.toView(i) < 0;
    });
    const r = page.reviewRoot();
    const targets = page.boardReview().targets;
    const index = new Map(page.visitors.map((v, k) => [v.name, k]));
    const points: VisitorPoint[] = page.visitors.map((v) => {
      const i = page.g.byName.get(v.name)!;
      const node = page.g.nodes[i];
      const edges = visitorEdges(page.g, i, page.toView, (u) => index.get(page.g.nodes[u].name) ?? -1);
      return {
        name: v.name,
        label: page.g.short(i),
        module: node.module,
        ext: page.g.isExt(i),
        place: v.place,
        kind: page.g.isExt(i) ? "external" : node.kind,
        axiom: ringed(node.kind),
        // in the scheme in force: Status's state, or Mine's
        status: page.pointState(i),
        target: Object.hasOwn(targets, v.name),
        key: r !== null && r !== i && page.flow.isKey(r, i),
        board: edges.board,
        visitors: edges.visitors,
      };
    });
    const sel = new Set([...page.clickedDecls(), ...(page.selected() !== null ? [page.selected()!] : [])].map((j) => visitorOf(j)).filter((k) => k >= 0));
    const places = page.canvas.setVisitors(points, [...sel], page.nav.board?.rec.hidden[page.cm()] ?? []);
    page.visitors = page.visitors.map((v, k) => {
      const p = places[k];
      return p && (v.place?.in !== p.in || v.place.at[0] !== p.at[0] || v.place.at[1] !== p.at[1]) ? { ...v, place: p } : v;
    });
    // a note attached to a visitor shows beside it
    page.stickies.render();
  };

  /** Bring a declaration into view: open what hides it, fly to it. `i` in the whole graph's
   *  numbering. */
  const reveal = (i: number) => {
    const j = page.toView(i);
    // a visitor: brought into view where it is out of it
    if (j < 0) {
      const at = page.canvas.visitorPos(visitorOf(i));
      if (!at) return;
      const [x, y] = at;
      const [sx, sy] = page.canvas.toScreen(x, y);
      const I = page.canvas.insets;
      const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
      if (sx < I.left + 20 || sx > W - I.right - 120 || sy < I.top + 20 || sy > H - I.bottom - 20) page.canvas.flyToPoint(x, y);
      return;
    }
    if (page.canvas.nodeRep[j] >= 0) page.canvas.toggleFold(page.canvas.nodeRep[j]);
    page.canvas.flyTo(j);
  };
  /** Bring what the panel tells of into view. */
  const revealShown = () => {
    const i = page.selected();
    if (i !== null) return reveal(i);
    const c = page.shownCluster();
    if (c >= 0) page.canvas.flyToCluster(c);
  };

  /** Go to a declaration (CanvasSpec, "Navigation"): a click there with the tool, and the view
   *  flies there; one step in the history. One the board does not hold is a visitor on it (ViewSpec
   *  decision 27), beside the declaration the reader comes from: navigation never leaves the board,
   *  and on a board of a past build the visitor is of that build. */
  const go = (i: number) => {
    if (page.toView(i) < 0) visitOn(i, page.selected());
    const p = page.pickDecl(page.g.nodes[i].name);
    page.picks = [p];
    page.shown = shownOf(p);
    apply();
    reveal(i);
    page.commit();
  };
  /** Go to a cluster of the board (a row of a cluster's panel): a click there with the tool. */
  const goCluster = (c: number) => {
    page.picks = [page.pickCluster(c)];
    page.shown = shownOf(page.picks[0]);
    apply();
    page.canvas.flyToCluster(c);
    page.commit();
  };

  /** Go to a declaration of the board's graph, by name — a visitor where the board does not hold it;
   *  false where the graph does not have it. */
  const goName = (name: string): boolean => {
    const i = page.g.byName.get(name);
    if (i === undefined) return false;
    go(i);
    return true;
  };

  /** Take a place on the board on show: the tool, the selection, what the panel tells of, and the
   *  camera — or, without one, what the panel tells of (flown to from the whole board, when the
   *  board is new), or the whole board. */
  const place = (p: Place, fresh: boolean) => {
    if (TOOLS.includes(p.mode)) useTool(p.mode);
    else store.save();
    page.picks = readSelection(p.picks);
    page.shown = p.shown ?? null;
    // the reader's own focus there, where they chose one (a place kept by an older page has none)
    page.mine = p.focus === null || typeof p.focus === "string" ? p.focus : undefined;
    // a followed reader's visitors, where they are on their board (ViewSpec decision 27)
    if (p.visitors) page.visitors = p.visitors;
    apply();
    if (p.cam) {
      page.canvas.cam = { ...p.cam };
      page.canvas.request();
    } else if (fresh) page.canvas.fit(false);
    // what the board does not hold of where the reader is, visitors in their places
    if (ensureVisitors()) apply();
    if (!p.cam && (page.selected() !== null || page.shownCluster() >= 0)) revealShown();
  };
  const here = (): Place => ({ cam: { ...page.canvas.cam }, mode: S.mode, picks: selectionText(page.picks), shown: page.shown, ...(page.mine !== undefined ? { focus: page.mine } : {}) });

  /** Zoom in: a view of what is lit, in a tab of its own, with the same selection; at the board's
   *  build (from the Time Machine too, which is left for it), focused as this view is (ViewSpec
   *  decision 28), and, where it is new, clustered as this board is, as a cluster's Zoom in is (one
   *  found open keeps its own). */
  const zoomIn = async () => {
    const q = page.zoomOf(selectionQuery(page.picks));
    if (!q) return;
    const r = await page.openDerived(printQuery(q), { mode: S.mode, picks: selectionText(page.picks), shown: page.shown, cam: null }, page.cm());
    if (typeof r === "string") page.say(r);
    else if (r) {
      page.canvas.fit(false);
      page.commit();
    }
  };
  /** The scope of a view of a cluster alone (its panel's Zoom in): what of it this board holds, as
   *  Zoom in has it; null when that is the whole board. */
  const clusterScope = (c: number): Query | null => page.zoomOf(clusterSet(page.canvas.layout.clusters[c].key, page.cm()));
  /** Zoom in on a cluster: a view of it alone, in a tab, clustered as this board is (a folder is
   *  shown by file), with the same selection; at the board's build. */
  const zoomCluster = async (c: number) => {
    const mode = page.cm();
    const scope = clusterScope(c);
    if (!scope) return;
    const r = await page.openDerived(printQuery(scope), { mode: S.mode, picks: selectionText(page.picks), shown: page.shown, cam: null }, mode);
    if (typeof r === "string") return page.say(r);
    if (!r) return;
    // a view found open has its own clustering: it is given this board's, unless it is a preview
    if (page.cm() !== mode && !page.frozen()) await page.sync.setClustering(mode);
    page.canvas.fit(false);
    page.commit();
  };

  /** Show a file: its cluster where the board clusters by file, else its first declaration. The
   *  clustering is the board's, everyone's: going somewhere does not change it. A file the board
   *  does not hold is shown by its first declaration, a visitor (ViewSpec decision 27). */
  const goToModule = (m: string) => {
    const c = page.canvas.layout.clusters.findIndex((cl) => cl.key === m);
    if (c >= 0) {
      if (page.canvas.folded.has(c)) page.canvas.toggleFold(c);
      return page.canvas.flyToCluster(c);
    }
    const i = page.g.nodes.findIndex((v, j) => v.module === m && !page.g.isExt(j));
    if (i < 0) return;
    if (page.toView(i) >= 0) return page.canvas.flyTo(page.toView(i));
    go(i);
  };

  /** Show what a trusted prefix covers: its cluster on this board if it is one here, or else the
   *  first declaration it covers (gone to, so that it shows where the outside world is hidden). */
  const goToPrefix = (p: string) => {
    // the cluster that stands for the prefix as the outline's rows do: outside the project, a
    // cluster by namespace is not what a prefix trusts there
    const c = page.canvas.layout.clusters.findIndex((cl) => clusterPrefix(cl, page.cm()) === p);
    if (c >= 0 && (!page.canvas.layout.clusters[c].ext || page.nav.board.bs.outside || !page.nav.board.bs.whole)) {
      if (page.canvas.folded.has(c)) page.canvas.toggleFold(c);
      return page.canvas.flyToCluster(c);
    }
    const i = page.g.nodes.findIndex((v, j) => covers(p, v.name, v.module, page.g.isExt(j)));
    if (i >= 0) go(i);
  };

  return {
    followSelection, newBuild, selectionFollowed, renderSelBar, apply, syncTool, clickOn, useTool, readerMode, clear, visitorOf, visitOn, drawVisitors, reveal,
    revealShown, go, goCluster, goName, place, here, zoomIn, clusterScope, zoomCluster, goToModule, goToPrefix,
  };
}
