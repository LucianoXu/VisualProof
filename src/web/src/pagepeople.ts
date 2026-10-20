// Who is here (CollabSpec decisions 3, 4 and 10; web/src/people.ts): the reader's name, the others
// on the server and their selections, following one of them, and asking others to follow.
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import type { PresenceView } from "../../shared/collab.ts";
import { escapeHtml } from "./highlight.ts";
import { People, READ_ONLY, personKey } from "./people.ts";
import { Asking, askMark } from "./askfollow.ts";
import type { AskFollow } from "../../shared/askfollow.ts";
import { PeerMenu } from "./peermenu.ts";
import { TOOLS } from "./selection.ts";
import type { Tool } from "./selection.ts";
import { ownAgents, PUBLIC, stateWords } from "./talk.ts";
import { isPhone } from "./phone.ts";
import { typing } from "./typing.ts";
import { VERIFIED } from "./verified.ts";
import { buildWhen } from "./timemachine.ts";
import { $, toolName, short } from "./page.ts";
import type { Page } from "./page.ts";

/** What who is here gives the page's other parts. */
export interface PeoplePart {
  people: People;
  asking: Asking;
  syncPeers: () => void;
}

export function peoplePart(page: Page): PeoplePart {
  const { data, store, reader } = page;

  // ---------------------------------------------------------------- who is here
  //
  // The reader's name (CollabSpec decision 3) at the top right, and the others on the server
  // (decision 4): their initials beside it, their selections on the canvas and in the panel, and
  // following one of them — to their view, opened in a tab if need be (ViewSpec decision 10).

  /** A reader's place in words: "Review ★fermatLastTheoremFour, looking at not_fermat_42". */
  const describePlace = (v: PresenceView): string => {
    const name = (m: string) => (TOOLS.includes(m as Tool) ? toolName(m as Tool) : m);
    const parts: string[] = [];
    const on = page.views.nameOf(v);
    if (on) parts.push(on);
    // in the Time Machine, at a build (HistorySpec decision 18)
    if (v.history) {
      const s = page.tm.snaps.find((x) => x.id === v.history!.snapshot);
      parts.push(`in the Time Machine at ${s ? buildWhen(s.at) : `build ${v.history.snapshot}`}`);
    }
    if (v.sel) parts.push(`${v.source ? "reading the source of" : "looking at"} ${short(v.sel)}`);
    return parts.join(", ") || `the whole project, ${name(v.mode)}`;
  };
  const people: People = new People(data, store, {
    view: page.whereIAm,
    say: (text) => page.say(text),
    describe: (v) => describePlace(v),
    follow: (v) => {
      page.artReach();
      void page.goWhere(v, false);
    },
    changed: () => {
      syncPeers();
      peerMenu.render();
      if (!reader) page.talk.peersChanged();
    },
    // the windows that stood for the followed reader's are this reader's own now, and none says any
    // more that the reader follows someone; what following left is theirs to leave (CollabSpec, "What
    // following leaves"): the artwork mode's bar, all but Share and Search out of reach again; the
    // linear form, which nothing on the screen says how to put away — the line does, once
    unfollowed: () => {
      // Mine, and mine(…), are the reader's own again (web/src/pagescheme.ts)
      page.mineChanged();
      page.sources.release();
      page.papers.unfollowed();
      page.artReach();
      if (!people.following && page.linear.followed && !page.exportModal.isOpen) page.say(`The board stays in the linear form you followed: ${isPhone() ? "⋯ at the bottom → Linear form puts" : "o, or ⋯ at the bottom → Linear form, puts"} it away.`);
    },
    // what is left to review where the review has a focus is the reader's own; who may read which of
    // the conversations, theirs
    renamed: () => {
      page.showSelected();
      page.renderStrip();
      // the reader's own review, which Mine shows and mine(…) reads, is under their name
      page.mineChanged();
      if (!reader) page.talk.identity();
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
    say: (text) => page.say(text),
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
      if (ownAgents([s], { name: people.name, person: people.person?.id ?? null }).length) page.talk.open(s.id);
      else page.talk.open(PUBLIC, s.name ?? undefined);
    },
    ask: (key) => {
      const p = people.people().find((x) => x.key === key);
      if (p) void asking.ask({ id: p.sessions[0].id, name: p.name ?? "This reader" });
    },
    cannotAsk: () => (reader ? READ_ONLY : asking.why(false)),
  });
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
        const j = page.toView(i);
        if (j >= 0) marks.push({ i: j, color: people.colorOf(p), label: people.label(p) });
      }
    }
    page.canvas.setPeers(marks);
    page.panel.refreshAlsoHere();
  };

  return { people, asking, syncPeers };
}
