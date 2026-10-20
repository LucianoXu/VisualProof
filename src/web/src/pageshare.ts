// What leaves the page: Share's links and agents' prompts (web/src/share.ts, CollabSpec decision 7),
// and Export's documents and pictures (web/src/exportmodal.ts, ExportSpec).
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import { briefWhen } from "../../shared/titles.ts";
import { docTitle, PROJECT } from "../../shared/views.ts";
import { followedOf } from "./surfaces.ts";
import { writeSnapshot } from "../../shared/sharesnap.ts";
import { Share } from "./share.ts";
import { planDoc } from "../../shared/doc/sections.ts";
import { ExportModal } from "./exportmodal.ts";
import type { ExportHooks } from "./exportmodal.ts";
import { $ } from "./page.ts";
import type { Page } from "./page.ts";

/** What Share and Export give the page's other parts. */
export interface SharePart {
  exportModal: ExportModal;
}

export function sharePart(page: Page): SharePart {
  const { data, store, S, site } = page;

  // a link to this view that lets whoever has it in, or a prompt for an AI agent with a token of its
  // own (web/src/share.ts); a snapshot is shared as a file
  new Share($("#share-btn"), $("#share-pop"), {
    info: () => data.shareInfo(),
    // the guest link and a read-only reader's own at the public address, as the server makes the
    // others (CollabSpec decision 7)
    base: () => site.base,
    data,
    me: () => page.people.name,
    person: () => page.people.person?.id ?? null,
    ensureName: () => page.people.ensure(),
    // what the reader sees (the owner's decision of 2026-10-12): every followed part as the registry
    // reads it, the camera as the region of the board it shows
    snapshot: () => writeSnapshot(followedOf(page.parts.read), page.canvas.screen),
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
      const b = page.nav.board;
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
        title: page.views.title(b.id),
        tip: page.views.tip(b.id),
        heading: docTitle(titled, page.views.titles()),
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
    shown: (open) => (open ? void page.linear.show("export") : page.people.following ? page.linear.hide("export") : page.linear.hide("export", "followed")),
    artwork: () => page.art.open(),
    artworkOnly: () => !!data.snapshot,
  });
  // a snapshot of the page carries the links, not the library's files (they are the server's)
  if (data.snapshot) $("#library-btn").hidden = true;

  return { exportModal };
}
