// Following (CollabSpec decision 4): what those following this reader see, part by part as
// web/src/surfaces.ts declares them, and going where a followed reader's state says, or a link's
// snapshot of what its sharer saw (decision 7).
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import type { PresenceView } from "../../shared/collab.ts";
import { focusFrom } from "../../shared/views.ts";
import { applyOwn, presenceOf } from "./surfaces.ts";
import type { PageParts } from "./surfaces.ts";
import { declPick, readSelection, selectionText, shownOf, TOOLS } from "./selection.ts";
import type { Tool } from "./selection.ts";
import { fileOf, linkOf } from "../../shared/library.ts";
import { camOf, goneNames, missingLine, readSnapshot, sortOut } from "../../shared/sharesnap.ts";
import { readVisitors, shareVisitors } from "./visitors.ts";
import type { Place } from "./viewnav.ts";
import type { Page } from "./page.ts";

/** What following gives the page's other parts. */
export interface FollowPart {
  parts: PageParts;
  whereIAm: () => PresenceView;
  goWhere: (v: PresenceView, once: boolean) => Promise<boolean>;
  openSnapshot: (text: string) => Promise<void>;
}

export function followPart(page: Page): FollowPart {
  const { S } = page;

  /** What those following this reader see (CollabSpec decision 4, the owner's decision of
   *  2026-10-11: what you see is followed), part by part as web/src/surfaces.ts declares them: how
   *  each is read into presence, and how a followed reader's is applied here — the place's parts
   *  together (`follow`, below), the others each on its own. */
  const parts: PageParts = {
    read: {
      view: () => ({ view: page.nav.board.id, scope: page.nav.query(), clusterMode: page.cm() }),
      // in the Time Machine, the build browsed (HistorySpec decision 18)
      history: () => (page.tm.active && page.tm.snapshot !== null ? { history: { snapshot: page.tm.snapshot } } : {}),
      camera: () => ({ cam: { ...page.canvas.cam } }),
      tool: () => ({ mode: S.mode }),
      selection: () => ({ selection: selectionText(page.picks) }),
      // the reader's own focus, where they chose one (ViewSpec decision 28), and their visitors
      // (decision 27)
      focus: () => (page.mine !== undefined ? { focus: page.mine } : {}),
      visitors: () => (page.visitors.length ? { visitors: shareVisitors(page.visitors, (k) => page.canvas.visitorPos(k)) } : {}),
      panel: () => ({ sel: page.shown && "decl" in page.shown ? page.shown.decl : null }),
      // the source windows, the following one and those pinned (decided 2026-10-09)
      sources: () => ({
        source: page.sources.open,
        ...(page.sources.following?.collapsed ? { sourceCollapsed: true } : {}),
        ...(page.sources.pinned.length ? { pinned: page.sources.pinned.map((p) => ({ decl: p.name, collapsed: p.collapsed })) } : {}),
      }),
      // the reference window (AttachmentSpec decision 11)
      paper: () => (page.papers.state() ? { paper: page.papers.state()! } : {}),
      activity: () => ({ activity: page.activity.state() }),
      lostFound: () => ({ lostFound: { open: page.lostDrawer.open } }),
      // the reader's own, under an artwork's, which the artwork's part carries
      colouring: () => ({ scheme: page.ownScheme() }),
      edges: () => ({ edges: S.showEdges }),
      linear: () => ({ linear: page.linear.shown }),
      artwork: () => ({ artwork: page.art.view() }),
    },
    // what this page shows is this reader's own once following ends, so it is kept as shown: the
    // colouring and the edges in this browser, as the reader's own choice is
    apply: {
      activity: (v) => page.activity.mirror(v.activity!),
      lostFound: (v) => page.lostDrawer.toggle(v.lostFound!.open),
      // Mine is the followed reader's own opinions while following them (web/src/pagescheme.ts)
      colouring: (v) => {
        if (page.ownScheme() !== v.scheme) page.chooseScheme(v.scheme!);
        page.mineChanged();
      },
      edges: (v) => page.setEdges(v.edges!),
      linear: (v) => (v.linear ? void page.linear.show("followed") : page.linear.hide("reader", "followed")),
      artwork: (v) => page.art.follow(v.artwork ?? null),
    },
  };
  /** Where this page is: what the others are told, and what Share tells an agent. */
  const whereIAm = (): PresenceView => presenceOf(parts.read, page.nav.tabs.map((t) => t.id));
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
    const { id, scope } = page.views.whereIs(v);
    // under Keys, whose key declarations is the view's to say: its focus to begin with, the target
    // linked to it first where nothing set it
    const rec = id ? page.views.rec(id) : undefined;
    const reviewed = rec ? focusFrom(rec) ?? null : null;
    const chosen = v.selection !== undefined ? readSelection(v.selection) : v.sel ? [declPick(mode, v.sel, page.keysFor({ decl: v.sel }, reviewed))] : [];
    // and their own focus, where they chose one (ViewSpec decision 28)
    const to: Place = { mode, picks: selectionText(chosen), shown: v.sel ? { decl: v.sel } : shownOf(chosen.at(-1)), cam: v.cam, ...(v.focus !== undefined ? { focus: v.focus } : {}), visitors: readVisitors(v.visitors) };
    // views are not switched in the Time Machine: it is left first, and opened again there
    if (page.tm.active && id !== page.tm.view) await page.tm.close();
    if (id === page.nav.board.id) page.place(to, false);
    else if (!(id && (await page.nav.select(id, to))) && scope) await page.nav.open(scope, to);
    const reached = page.nav.board.id === id || (scope !== null && page.nav.query() === scope);
    if (once && !reached) page.place(to, false);
    // following ended while their view was being opened (the reader's own act): nothing more of the
    // followed reader's is taken — their build, their windows —, and the windows the reader has
    // opened since are their own, nothing of the followed reader's closing them (CollabSpec, "What
    // following leaves")
    const ended = () => !once && !page.people.following;
    // where they are in the Time Machine (HistorySpec decision 18): the same build, or none
    if (!ended()) {
      if (v.history) {
        if (!page.tm.active) await page.tm.open({ snapshot: v.history.snapshot });
        else if (page.tm.snapshot !== v.history.snapshot) await page.tm.show(v.history.snapshot);
      } else if (page.tm.active) await page.tm.close();
    }
    page.writeAddress(false);
    if (ended()) return reached;
    // what their panels and their board show besides: Activity, the lost-and-found, the colouring,
    // the edges — each their page says (an older one says none: this reader's stay)
    applyOwn(v, parts.apply);
    // their reference window, as theirs is; from a link, once the source windows are open, whose
    // pairing would otherwise open another beside them
    if (!once) page.papers.mirror(v.paper);
    // their source windows, mirrored in this reader's, each where this page puts it: the one
    // following their selection, and those they pinned that this page's graph has; a past build
    // has none
    if (!page.pastShown())
      page.sources.mirror({
        following: v.source ? { decl: page.selected(), collapsed: v.sourceCollapsed === true } : null,
        pinned: (v.pinned ?? []).flatMap((w) => {
          const i = page.g.byName.get(w.decl);
          return i === undefined ? [] : [{ decl: i, collapsed: w.collapsed }];
        }),
      });
    if (once) {
      page.papers.mirror(v.paper);
      // the windows are this reader's own from now on, as when following ends
      page.sources.release();
      page.papers.unfollowed();
    }
    return reached;
  };

  /** Open a link's snapshot of what its sharer saw (CollabSpec decision 7, the owner's decision of
   *  2026-10-12), on the board its address opened: what still makes sense is applied once, as
   *  starting to follow applies it, the camera framing the region of the board the sharer framed;
   *  one short line says what could not be shown. */
  const openSnapshot = async (text: string) => {
    const shot = await readSnapshot(text, page.canvas.screen);
    if (!shot) return page.say("This link's snapshot of what its sharer saw could not be read: it opens on its view alone.");
    // the build browsed, the reference window's file and its link, where they are still here
    if (shot.view.history) await page.tm.load();
    const { view, gone } = sortOut(shot.view, { build: (id) => page.tm.snaps.some((s) => s.id === id), file: (sha) => !!fileOf(page.review.data, sha), link: (id) => !!linkOf(page.review.data, id) });
    const v: PresenceView = { mode: S.mode, sel: null, source: false, clusterMode: page.cm(), cam: null, view: page.nav.board.id, scope: null, tabs: [], ...view };
    // a view nobody keeps was opened by the address's query, at the build it carries: the snapshot's
    // id for it may be gone, its query is the same
    if (v.scope && page.nav.query() === v.scope) v.view = page.nav.board.id;
    gone.view = !(await goWhere(v, true));
    // what the board's graph (a past build's, in the Time Machine) does not hold, and a focus on what
    // is no target now
    const picked = readSelection(v.selection).flatMap((p) => (p.root && "decl" in p.root ? [p.root.decl] : []));
    Object.assign(gone, goneNames(v, picked, { decl: (n) => page.g.byName.has(n), target: (n) => Object.hasOwn(page.review.data.targets, n) }));
    // the region framed again, now that the panels the snapshot opened leave the board its room
    if (shot.region) {
      page.syncInsets();
      page.canvas.jumpTo(camOf(shot.region, page.canvas.screen));
    }
    // an artwork's frame holds what the sharer's held
    if (v.artwork) page.art.follow(v.artwork);
    const line = missingLine(gone);
    if (line) page.say(line);
  };

  return { parts, whereIAm, goWhere, openSnapshot };
}
