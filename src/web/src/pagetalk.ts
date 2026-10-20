// The conversations (CollabSpec decision 13, web/src/talk.ts): Everyone and the reader's own
// agents, in the window the reader opens (web/src/chatwin.ts, placed by web/src/pagelayout.ts), its
// button, and the notice of a mention; a link of this site named by what the page knows.
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import type { ChatMessage } from "../../shared/collab.ts";
import { noteExcerpt } from "../../shared/sticky.ts";
import { PROJECT } from "../../shared/views.ts";
import { escapeHtml } from "./highlight.ts";
import { restsOn } from "./selection.ts";
import { excerpt, PUBLIC, Talk } from "./talk.ts";
import { chipOf, copyLink, siteLink, withoutKeys } from "./chatlinks.ts";
import type { Chip } from "./chatlinks.ts";
import { $, MODE_NAME } from "./page.ts";
import type { Page } from "./page.ts";

/** What the conversations give the page's other parts. */
export interface TalkPart {
  talk: Talk;
  chipFor: (url: string) => Chip | null;
}

export function talkPart(page: Page): TalkPart {
  const { data, store, kept, reader, site } = page;

  /** The declaration a name in an agent's message stands for: a full name, or the one declaration
   *  whose name ends with it; null where there is none, or several. */
  const resolveName = (name: string): string | null => {
    if (!/^[\p{L}\p{N}_'!?.«»₀-₉]+$/u.test(name)) return null;
    if (page.g.byName.has(name)) return name;
    const tail = "." + name;
    let found: string | null = null;
    for (const n of page.g.nodes)
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
    win: page.chatWin,
    me: () => ({ name: page.people.name, person: page.people.person?.id ?? null }),
    ensureName: () => page.people.ensure(),
    place: page.whereIAm,
    peers: () => page.people.peers,
    resolve: resolveName,
    go: (name) => {
      page.people.unfollow();
      const i = page.g.byName.get(name);
      if (i !== undefined) page.go(i);
    },
    open: (hash) => {
      page.people.unfollow();
      page.openAddress(hash);
    },
    chip: (url) => chipFor(url),
    seenLink: async () => copyLink({ origin: site.base, pathname: location.pathname }, await page.seenHash()),
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
    if (page.chatWin.open && !page.chatWin.collapsed) page.chatWin.close();
    else page.chatWin.show(true);
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
  if (store.data.chatOpen && !talkBtn.hidden) page.chatWin.show();
  /** A link of this site's chip (CollabSpec decision 13, web/src/chatlinks.ts): named by what the page
   *  knows — a view's title, a note's words; null for any other link and one it cannot read. */
  const chipFor = (url: string): Chip | null => {
    const l = siteLink(url, site.origins);
    if (!l) return null;
    return chipOf(l, {
      view: (id) => (id === PROJECT ? "the Project" : page.views.summary(id) ? page.views.title(id) : null),
      note: (id, ofView, view) => {
        const text = ofView ? (view ? page.views.rec(view)?.notes?.find((n) => n.id === id)?.text : undefined) : page.projectNotes.get(id)?.text;
        return text ? noteExcerpt(text, 40) : null;
      },
      tool: (t) => (restsOn(t) ? "Rests on" : MODE_NAME[t]),
    });
  };

  return { talk, chipFor };
}
