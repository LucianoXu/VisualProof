// History and the address (CanvasSpec, "Navigation"): every step an entry in the browser's
// history, the state in the address, a link of this site followed in the page.
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import { PROJECT } from "../../shared/views.ts";
import { followedOf } from "./surfaces.ts";
import { selectionText } from "./selection.ts";
import { snapshotIn, withSnapshot, writeSnapshot } from "../../shared/sharesnap.ts";
import { recipeIn } from "../../shared/artrecipe.ts";
import { noteIn } from "./chatlinks.ts";
import { decodeState, encodeState } from "./state.ts";
import type { ViewState } from "./state.ts";
import type { Place } from "./viewnav.ts";
import { $, VIEW_GONE } from "./page.ts";
import type { Page } from "./page.ts";

/** What the address gives the page's other parts. */
export interface AddressPart {
  current: () => ViewState;
  seenHash: () => Promise<string>;
  renderNav: () => void;
  writeAddress: (push: boolean) => void;
  commit: () => void;
  openAddress: (hash: string) => void;
}

export function addressPart(page: Page): AddressPart {
  const { S } = page;

  // ---------------------------------------------------------------- history and the address
  //
  // Every step (a click on a declaration, a row, a name; another view) is an entry in the browser's
  // history, with the state in the address, so back and forward work as they do anywhere and every
  // view is a link. The camera travels in the entry, not the address.

  let navTop = 0;
  const current = (): ViewState => ({
    view: page.nav.query() === null ? page.nav.board.id : null,
    scope: page.nav.query(),
    // a view nobody keeps, of a past build: the build travels with its query
    version: page.nav.queryVersion(),
    mode: S.mode,
    picks: selectionText(page.picks),
    shown: page.shown,
  });
  const entry = () => (history.state && typeof history.state.n === "number" ? (history.state as { n: number; cam?: object; tm?: number }) : { n: 0 });
  /** The address of what this reader sees, with its snapshot (CollabSpec decision 7): what a link to
   *  what they see carries, whatever Share's switch (decision 13); the address alone where the
   *  snapshot cannot be made. */
  const seenHash = async (): Promise<string> => {
    const hash = encodeState(current());
    const snap = await writeSnapshot(followedOf(page.parts.read), page.canvas.screen).catch(() => null);
    return snap ? withSnapshot(hash, snap).slice(1) : hash;
  };
  /** In the Time Machine, the build its board shows travels in the entry (not the address: where a
   *  reader is in it is their own, HistorySpec decision 18), so that back and forward return to a
   *  past board at its build (the owner's decision of 2026-10-09). */
  const tmEntry = (): { tm?: number } => (page.tm.active && page.tm.shown !== null && page.tm.shown !== page.tm.latest ? { tm: page.tm.shown } : {});
  const renderNav = () => {
    const back = entry().n > 0, forward = entry().n < navTop;
    $<HTMLButtonElement>("#nav-back").disabled = !back;
    $<HTMLButtonElement>("#nav-fwd").disabled = !forward;
    page.steps = { back, forward };
    page.sources.following?.setNav(back, forward);
  };
  /** Write the state into the address: a new entry (`push`) or the current one. */
  const writeAddress = (push: boolean) => {
    // a view still being opened (a link, back, forward): the address already says where it goes
    if (!push && page.nav.busy) return;
    const hash = "#" + encodeState(current()) + page.filmPart;
    try {
      if (push && hash !== location.hash) {
        // the entry being left remembers where the camera was
        history.replaceState({ ...entry(), cam: { ...page.canvas.cam } }, "");
        const n = entry().n + 1;
        history.pushState({ n, ...tmEntry() }, "", hash);
        navTop = n;
      } else if (hash !== location.hash) {
        const { tm: _was, ...rest } = entry();
        history.replaceState({ ...rest, ...tmEntry() }, "", hash);
      }
    } catch {
      // a browser that refuses: the page works, the address just does not follow
    }
    renderNav();
    page.nav.remember();
    page.people.report();
  };
  const commit = () => writeAddress(true);

  /** Take a state from the address (a link, back, forward): its view, opened again from its query
   *  if need be; the camera from the entry if it has one. */
  const restore = async (st: ViewState, cam: { x: number; y: number; k: number } | null, tmAt?: number) => {
    const to: Place = { mode: st.mode, picks: st.picks, shown: st.shown, cam };
    const id = st.view ?? (st.scope ? null : PROJECT);
    // an entry made in the Time Machine returns to its build
    const atBuild = async () => {
      if (typeof tmAt !== "number") return;
      if (!page.tm.active) await page.tm.open({ snapshot: tmAt });
      else if (page.tm.snapshot !== tmAt) await page.tm.show(tmAt);
    };
    if (id === page.nav.board.id || (!id && st.scope === page.nav.query() && (st.version ?? null) === page.nav.queryVersion())) {
      // a view still being laid out for a step before is not gone to after all
      page.stay();
      page.place(to, false);
      return atBuild();
    }
    // back or forward to another view: the Time Machine is left, as views are not switched in it
    if (page.tm.active) await page.tm.close();
    if (id && (await page.nav.select(id, to))) return atBuild();
    // a view nobody keeps opens again at the build it showed
    const opened = st.scope ? await page.nav.open(st.scope, to, { version: st.version ?? null }) : false;
    if (opened === true) return atBuild();
    // gone, or never there (an address typed or kept): the Project, and why
    await page.nav.select(PROJECT, to);
    if (typeof opened === "string") page.say(`This link's view could not be opened: ${opened}`);
    else if (id && id !== PROJECT && !page.views.summary(id)) page.say(VIEW_GONE);
  };
  /** Take what the address says (a link, back, forward): its board; a link with a snapshot opened in
   *  this tab, then what its sharer saw, once; an artwork's recipe, once; the note a link names. */
  const followAddress = (cam: { x: number; y: number; k: number } | null, tmAt?: number): Promise<void> => {
    const st = decodeState(location.hash);
    const snap = snapshotIn(location.hash);
    const recipe = recipeIn(location.hash);
    const note = noteIn(location.hash);
    return (st ? restore(st, cam, tmAt) : Promise.resolve())
      .then(() => (snap ? page.openSnapshot(snap).then(() => writeAddress(false)) : undefined))
      .then(() => {
        // the recipe is read: the address goes back to the board's at once, as at the first load
        if (!recipe) return;
        void page.openRecipe(recipe);
        writeAddress(false);
      })
      .then(() => {
        if (note) page.showNote(note.ofView ? page.nav.board.id : "", note.id);
        // the address names what is shown (CanvasSpec, "Navigation"), also where it named a view
        // that is gone or what no state reads as
        writeAddress(false);
        renderNav();
        page.people.report();
      });
  };
  window.addEventListener("popstate", (e) => {
    const cam = (e.state as { cam?: { x: number; y: number; k: number } } | null)?.cam ?? null;
    const tmAt = (e.state as { tm?: unknown } | null)?.tm;
    void followAddress(cam, typeof tmAt === "number" ? tmAt : undefined);
  });
  /** A link of this site followed from a conversation (CollabSpec decision 13): its address applied
   *  in the page as a share link is — its board, what its sharer saw, the note it names — without a
   *  reload; a step of the reader's history, which Back returns from. */
  const openAddress = (hash: string) => {
    const to = "#" + hash.replace(/^#/, "");
    try {
      // the entry being left remembers where the camera was
      history.replaceState({ ...entry(), cam: { ...page.canvas.cam } }, "");
      const n = entry().n + 1;
      history.pushState({ n }, "", to);
      navTop = n;
    } catch {
      return;
    }
    void followAddress(null);
  };
  $("#nav-back").addEventListener("click", () => history.back());
  $("#nav-fwd").addEventListener("click", () => history.forward());

  return { current, seenHash, renderNav, writeAddress, commit, openAddress };
}
