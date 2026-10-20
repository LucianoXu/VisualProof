// What happened: the timeline (CollabSpec decision 5, web/src/activity.ts) and the lost-and-found
// (HistorySpec decisions 12–14, web/src/lostfound.ts), each in the drawer on the right; and the
// notes either of them leads to.
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import { SITE_BODY, SITE_STMT } from "../../shared/graph.ts";
import { covers } from "../../shared/review.ts";
import { PROJECT, titleOfScope } from "../../shared/views.ts";
import { READ_ONLY } from "./people.ts";
import { Activity } from "./activity.ts";
import { LostAndFound } from "./lostfound.ts";
import { $ } from "./page.ts";
import type { Page } from "./page.ts";

/** What the drawers give the page's other parts. */
export interface TimelinePart {
  targetTcbs: Map<string, { names: Set<string>; modules: Set<string> } | null>;
  showNote: (view: string, id: string) => void;
  activity: Activity;
  lostDrawer: LostAndFound;
}

export function timelinePart(page: Page): TimelinePart {
  const { data, store, reader } = page;

  // ---------------------------------------------------------------- what happened
  //
  // The timeline (CollabSpec decision 5) in a drawer on the right. What "My targets" and a build's
  // warning look at: each target's TCB, its declarations and their modules, worked out once per
  // graph and review — on the graph on show, whatever build the board shows: the timeline is the
  // review's, which does not depend on the board.

  const targetTcbs = new Map<string, { names: Set<string>; modules: Set<string> } | null>();
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

  // a view whose record this page holds says whether the note is on it; another, whether the view
  // is there; a note of the project (`view` ""), whether the project still has it
  const hasNote = (view: string, id: string): boolean => {
    if (view === "") return !!page.projectNotes.get(id);
    const r = page.views.rec(view);
    return r ? !!r.notes?.some((n) => n.id === id) : !!page.views.summary(view);
  };
  const showNote = (view: string, id: string): void => {
    // a note of the project: on the board on show where it holds it, else on the Project, which
    // holds what every note is about
    if (view === "") {
      if (page.stickies.has(id)) return page.stickies.flyTo(id);
      if (!page.projectNotes.get(id)) return page.say("That note is no longer the project's.");
      view = PROJECT;
    }
    // views are not switched in the Time Machine
    if (view !== page.nav.board.id && page.noSwitch()) return;
    void (view === page.nav.board.id ? Promise.resolve(true) : page.nav.select(view)).then((ok) => {
      if (!ok) return;
      if (view !== page.nav.board.id) page.commit();
      if (page.stickies.has(id)) page.stickies.flyTo(id);
      else page.say("That note is no longer on this view.");
    });
  };

  const activity = new Activity($("#activity"), $("#activity-btn"), $("#activity-badge"), store, {
    me: () => page.people.name,
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
    comment: (text, name) => page.reviewBox.comment(text, name),
    openOpinion: (r) => page.reviewBox.jump(r, null, null),
    openSource: (r, quoted) => page.openSourceAt(r.name, r.from, r.to, quoted, null),
    reviewTarget: (name) => {
      const i = page.g.byName.get(name);
      if (i !== undefined) page.reviewTarget(i);
    },
    goToModule: (m) => page.goToModule(m),
    hasView: (id) => !!page.views.summary(id),
    openView: (id) => void page.openView(id),
    viewTitle: (id) => page.views.title(id),
    scopeTitle: (scope) => titleOfScope(scope, page.views.titles()),
    scopeTip: (scope) => page.views.tip("", scope),
    hasNote: (view, id) => hasNote(view, id),
    showNote: (view, id) => showNote(view, id),
    // the lost-and-found's drawer takes the same place: one of the two is open
    toggled: (open) => {
      if (open && lostDrawer.open) lostDrawer.toggle(false);
      page.syncInsets();
    },
    stateChanged: () => page.people.report(),
    migrations: () => lostDrawer.migrations(),
    openLost: (key) => lostDrawer.show(key),
    // a snapshot of the page has no reference window: its files and links are text there
    ...(data.snapshot ? {} : { openFile: (sha: string) => page.papers.openFile(sha), openLink: (id: string) => page.papers.openLink(id) }),
    // an agent's layout, put back: under the reader's name, as the timeline records it (a private
    // reader's, without one)
    undo: async (id) => {
      if (reader) return READ_ONLY;
      if (!(await page.people.ensureLayout())) return "An undo is recorded under your name: give one first.";
      const r = await data.undoLayout(id);
      if (r.who) page.people.lost();
      return r.error ?? null;
    },
  });

  // ---------------------------------------------------------------- the lost-and-found

  // what was said of declarations the graph no longer has (HistorySpec decisions 12–14), in a drawer
  // where Activity's is, opened from the build-status popover
  const lostDrawer = new LostAndFound($("#lostfound"), data.lost, {
    has: (name) => page.g.byName.has(name),
    go: (name) => {
      const i = page.g.byName.get(name);
      if (i !== undefined) page.go(i);
    },
    hasView: (id) => !!page.views.summary(id),
    openView: (id) => void page.openView(id),
    hasNote: (view, id) => hasNote(view, id),
    showNote: (view, id) => showNote(view, id),
    comment: (text, name) => page.reviewBox.comment(text, name),
    // Attach to…: a declaration of the graph, picked with the search, by its name now (a board of a
    // past build searches its own graph)
    pick: (prompt) => page.searchBox.pick(prompt).then((i) => (i === null ? null : page.declNow(i))),
    timeMachine: (at) => page.timeMachine(at),
    ensureName: () => page.people.ensure(),
    nameLost: () => page.people.lost(),
    toggled: (open) => {
      if (open && activity.open) activity.toggle(false);
      page.syncInsets();
      page.people.report();
    },
    changed: () => {
      activity.changed();
      if (!page.pop.hidden) page.renderPop();
    },
  });

  return { targetTcbs, showNote, activity, lostDrawer };
}
