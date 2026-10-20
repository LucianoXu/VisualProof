// The tabs (web/src/tabs.ts): the views this reader has open and the views menu, the review's focus
// in the view's header (web/src/focus.ts), the targets in the side panel (web/src/targetlist.ts),
// and opening a view, or a target's, linked to it (ViewSpec decision 29).
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import { linkRefused, titleOfScope } from "../../shared/views.ts";
import type { ViewAnswer } from "./data.ts";
import { READ_ONLY } from "./people.ts";
import { FocusMenu } from "./focus.ts";
import { selectionText, shownOf } from "./selection.ts";
import { Tabs } from "./tabs.ts";
import { TargetList, targetStep } from "./targetlist.ts";
import type { Place } from "./viewnav.ts";
import { buildWhen } from "./timemachine.ts";
import { $, short } from "./page.ts";
import type { Page } from "./page.ts";

/** What the tabs give the page's other parts. */
export interface TabsPart {
  made: (r: ViewAnswer) => Promise<string | null>;
  named: () => Promise<string | null>;
  tabs: Tabs;
  focusMenu: FocusMenu;
  targetList: TargetList;
  renderTabs: () => void;
  openView: (id: string) => Promise<void>;
  reviewTarget: (i: number) => void;
  linkWhy: (name: string) => string | null;
  linkTo: (name: string) => Promise<string | null>;
}

export function tabsPart(page: Page): TabsPart {
  const { data, S, reader } = page;

  // ---------------------------------------------------------------- the tabs
  //
  // The views this reader has open, and the views menu (web/src/tabs.ts).

  /** A new view or a copy, under the reader's name (it is recorded), shown in a tab. */
  const made = async (r: ViewAnswer): Promise<string | null> => {
    if (r.who) page.people.lost();
    if (!r.view) return r.error ?? "The view could not be made.";
    if (page.tm.active) await page.tm.close();
    await page.views.load();
    if (await page.nav.show(r.view.id, null)) page.commit();
    page.sync.afterPost();
    return null;
  };
  // a private reader's view is made without their name, and needs none (CollabSpec decision 8)
  const named = async (): Promise<string | null> => (reader ? READ_ONLY : data.snapshot || (await page.people.ensureLayout()) ? null : "A view is made under your name: give one first.");
  const tabs = new Tabs($("#tabs"), $("#views-btn"), $("#views-menu"), {
    tabs: () => page.nav.tabs,
    active: () => page.nav.board?.id ?? null,
    // a tab of a view the server forgot is called by its query, at the build it shows
    title: (id) => {
      const t = !page.views.summary(id) && !page.views.rec(id) ? page.nav.tabs.find((x) => x.id === id) : undefined;
      return t?.q ? titleOfScope(t.q, page.views.titles(), t.at) : page.views.title(id);
    },
    tip: (id) => page.views.tip(id, page.nav.tabs.find((x) => x.id === id)?.q),
    summary: (id) => page.views.summary(id),
    list: () => page.views.summaries,
    select: (id) => void openView(id),
    close: (id) => void page.nav.close(id).then(() => page.writeAddress(false)),
    create: async (name) => (await named()) ?? made(await page.views.post("create", { name })),
    duplicate: async (name) => (await named()) ?? made(await page.views.post("create", { name, from: page.nav.board.id })),
    rename: async (name) => {
      const why = await named();
      if (why) return why;
      const r = await page.sync.change("rename", { name });
      if (r.error) return r.error;
      page.nav.board.rec.name = name;
      page.nav.board.rec.kept = true;
      renderTabs();
      page.boardPanel.render();
      return null;
    },
    remove: async () => {
      const why = await named();
      if (why) return why;
      const id = page.nav.board.id;
      const r = await page.sync.change("delete", {});
      if (r.error) return r.error;
      await page.nav.close(id);
      page.writeAddress(false);
      return null;
    },
    readOnly: () => !!data.snapshot || !!reader,
    frozen: () => (reader ? READ_ONLY : null),
    build: (id) => {
      const s = page.tm.snaps.find((x) => x.id === id);
      return s ? `${buildWhen(s.at)}${s.commit ? ` · ${s.commit.hash.slice(0, 7)}` : ""}` : null;
    },
    short: (t) => page.views.titles().names?.decl(t) ?? short(t),
    // the reader's focus, where its view is another than this one (ViewSpec decision 29)
    linkable: () => {
      const t = page.nav.board ? page.reviewName() : null;
      if (t === null || page.views.linkedTo(t) === page.nav.board.id) return null;
      return { target: t, why: linkWhy(t) };
    },
    link: (t) => linkTo(t),
  });

  // the review's focus on the board on show, in the view's header (ViewSpec decision 28;
  // web/src/focus.ts): the view's own, everyone's, or the reader's, theirs as the camera is
  const focusMenu = new FocusMenu($("#focus-btn"), $("#focus-menu"), {
    state: () => (page.nav.board ? { view: page.viewFocusName(), mine: page.mine, focus: page.reviewName(), linked: page.linkedTargets(), held: page.heldTargets() } : null),
    short: (name) => page.views.titles().names?.decl(name) ?? short(name),
    choose: (f) => {
      page.mine = f;
      page.apply();
      page.writeAddress(false);
    },
    setView: async (f) => {
      if (page.frozen()) return page.frozenWhy();
      const why = await named();
      if (why) return why.replace("A view is made", "The view's focus is set");
      const r = await page.sync.change("focus", { focus: f });
      if (r.error) return r.error;
      page.nav.board.rec.focus = f;
      // the reader's focus is the view's now: nothing of their own is left
      page.mine = undefined;
      page.apply();
      page.writeAddress(false);
      return null;
    },
    canSet: () => !page.frozen(),
  });

  // the targets at the top of the side panel, each opening its view (web/src/targetlist.ts)
  const targetList = new TargetList($("#targets"), {
    readOnly: () => !!data.snapshot || !!reader,
    list: () => page.views.summaries,
    targets: () => Object.keys(page.review.data.targets),
    active: () => page.nav.board?.id ?? null,
    progress: (t) => {
      const i = page.present.byName.get(t);
      return i === undefined ? null : page.flowNow.progress(i);
    },
    keyProgress: (t) => {
      const i = page.present.byName.get(t);
      return i === undefined ? null : page.flowNow.keyProgress(i);
    },
    open: (id, target) => openTarget(id, target),
    title: (id) => page.views.title(id),
    shut: page.shut,
    toggle: page.toggleSection,
  });
  /** The tabs, and the targets beside them: both follow the views and how far each review has come. */
  function renderTabs(): void {
    tabs.render();
    targetList.render();
  }

  /** Open a view (a tab, a row of the menu, an event of the timeline): one step in the history. */
  const openView = async (id: string) => {
    if (id === page.nav.board.id) return page.stay();
    if (page.noSwitch()) return;
    if (await page.nav.select(id)) page.commit();
  };
  /** A target, from the targets list: its view, on the target, or, with none (`id` null), a view
   *  nobody keeps of its TCB, linked to it (see reviewTarget); a target no longer in the graph opens
   *  its view alone, and with none has nowhere to go. */
  const openTarget = (id: string | null, target: string) => {
    if (id !== null && id !== page.nav.board.id && page.noSwitch()) return;
    const i = page.g.byName.get(target);
    if (i !== undefined) reviewTarget(i);
    else if (id !== null) void openView(id);
    else page.say(`★${short(target)} is not in the graph now, and has no view.`);
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
    const name = page.declNow(i);
    const linked = page.views.linkedTo(name);
    // a target's view opens with the target selected alone under the tool the reader has (the
    // owner's decision of 2026-10-12: the tool is never changed for them), and the target the
    // reader's focus there, whatever the view's own focus is (ViewSpec decisions 15 and 29); a
    // read-only reader, who opens no view (CollabSpec decision 11), goes to a target with none on
    // the board on show
    if ((linked !== undefined && targetStep(linked, page.nav.board.id) === null) || (linked === undefined && reader)) {
      page.mine = name;
      page.go(i);
      page.writeAddress(false);
      return;
    }
    if (page.noSwitch()) return;
    const p = page.pickDecl(name, name);
    const to: Place = { mode: S.mode, picks: selectionText([p]), shown: shownOf(p), cam: null, focus: name };
    if (linked !== undefined) {
      void page.nav.select(linked, to).then((ok) => {
        if (ok) page.commit();
        // its view deleted meanwhile: the target on the board on show
        else page.go(i);
      });
      return;
    }
    void (async () => {
      const v = await page.views.openTarget(name);
      if (typeof v === "string") return page.say(v);
      // the list holds the link before the server's word comes: the next click finds it there
      await page.views.load();
      renderTabs();
      if (!(await page.nav.select(v.id, to))) return;
      page.commit();
      if (!v.kept) page.say(`★${short(name)} had no view: this view of its TCB is its view while it lasts. Pin, fold or name it to keep it, and its link with it.`);
    })();
  };
  /** Why target `name` cannot be linked to the view on show now, or null (ViewSpec decision 29). */
  const linkWhy = (name: string): string | null => {
    if (data.snapshot) return null;
    if (page.frozen()) return page.frozenWhy();
    return linkRefused(page.nav.board.rec, name);
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
    const r = await page.sync.change("link", { target: name });
    if (r.error) return r.error;
    const rec = page.nav.board.rec;
    if (!rec.targets?.includes(name)) rec.targets = [...(rec.targets ?? []), name];
    if (rec.targets.length === 1) rec.focus = name;
    rec.kept = true;
    page.apply();
    renderTabs();
    page.say(`★${short(name)} is linked to this view now: clicking ★${short(name)} opens it.`);
    return null;
  };

  return { made, named, tabs, focusMenu, targetList, renderTabs, openView, reviewTarget, linkWhy, linkTo };
}
