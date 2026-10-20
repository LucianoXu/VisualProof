// Search, and the page's keys (web/src/surfaces.ts declares each).
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import { SearchBox } from "./search.ts";
import { keyTwo } from "./selection.ts";
import { routeKey } from "./sources.ts";
import { typing } from "./typing.ts";
import { $, PAST_REVIEW } from "./page.ts";
import type { Page } from "./page.ts";

/** What search and the keyboard give the page's other parts. */
export interface KeysPart {
  searchBox: SearchBox;
}

export function keysPart(page: Page): KeysPart {
  const { data, S } = page;

  // ---------------------------------------------------------------- search

  const input = $<HTMLInputElement>("#search");
  const searchBox = new SearchBox(input, $("#results"), page.g, { go: (i) => page.go(i) });

  // a file chosen by a button that is a label holding a hidden file field (the library's Upload, a
  // missing file's Add it…): Enter or Space on it opens the chooser, as a click does — the control's
  // own press, not a key of the page's
  document.addEventListener(
    "keydown",
    (e) => {
      const t = e.target as HTMLElement | null;
      const press = e.key === "Enter" || e.key === " ";
      const field = press && t?.matches?.("label[role=button]") ? t.querySelector<HTMLInputElement>("input[type=file]") : null;
      if (!field) return;
      e.preventDefault();
      e.stopPropagation();
      field.click();
    },
    true,
  );

  // ---------------------------------------------------------------- keyboard

  window.addEventListener("keydown", (e) => {
    // the source window the key is pressed in, if any: its keys are its own (web/src/sources.ts,
    // routeKey), the rest are the page's as anywhere — the windows are not modal
    const win = page.sources.at(e.target);
    // typing into a field: the keys are text; Esc only leaves the field — inside a source window,
    // for the window, where the next Esc closes it
    if (typing(e.target) || typing(document.activeElement)) {
      if (e.key === "Escape" && e.target !== input && !$("#modal").contains(e.target as Node)) {
        if (win) win.el.focus();
        else (e.target as HTMLElement).blur();
      }
      return;
    }
    // the conversation's window keeps its keys (Enter and Space on its buttons and links); Esc there
    // stops following (web/src/people.ts)
    if ((e.target as Element | null)?.closest?.("#following:not([hidden])")) return;
    if (page.exportModal.isOpen) {
      if (e.key === "Escape") page.exportModal.close();
      return;
    }
    if (!$("#modal").hidden || !$("#help").hidden) return;
    // the canvas's menu, on what is selected
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      page.menuOnSelection();
      return;
    }
    // in the artwork mode, the keys that act on the board alone: Search, the tool, the zoom, the
    // outside world, the levels, the lock — not those that open what the mode puts away
    if (page.artLook && !page.ART_KEYS.has(e.key)) return;
    // with Ctrl or ⌘ a letter is the browser's (Ctrl L, Ctrl F, …), and the drag key held is the lock's
    if ((e.ctrlKey || e.metaKey) && e.key.length === 1) return;
    const route = routeKey(e.key, win !== null, !!(e.target as Element | null)?.closest?.("button, a[href], summary, select"));
    // Space on a window's button or link presses it
    if (route === "press") return;
    // and on any button reached from the keyboard, as everywhere (surfaces.ts: Enter or Space on a
    // control presses it); on one the pointer pressed last, where the focus stays, Space is the page's
    // key for the source
    if (e.key === " " && (e.target as Element | null)?.matches?.(":focus-visible") && (e.target as Element).closest("button, summary")) return;
    if (win && route === "close") {
      e.preventDefault();
      page.sources.close(win);
      return;
    }
    if (win && route === "own") {
      // approve, comment on or mark key the window's own declaration, as its buttons do: in a pinned
      // window that is not the selection
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      e.preventDefault();
      if (e.key === "k") page.toggleKey(win.decl);
      else page.reviewBox.give(e.key === "a" ? "approve" : "comment", win.decl, win.el);
      return;
    }
    if (e.key === "/") {
      e.preventDefault();
      searchBox.focus();
    } else if (e.key === "1") page.readerMode("plain");
    // Rests on, at the step last used; pressed again, its next step (web/src/selection.ts, keyTwo)
    else if (e.key === "2") page.readerMode(keyTwo(S.mode, S.restsOn));
    else if (e.key === "3") page.readerMode("apps");
    else if (e.key === " ") {
      // Space opens and closes the source window that follows the selection, and opens it again
      // from its pill (CanvasSpec, "Hover, click, drag"); on a past board, the text of that build.
      // Closing it closes the reference window paired beside it too (AttachmentSpec decision 8)
      e.preventDefault();
      const p = page.sources.following;
      const together = !!p && !p.collapsed && page.papers.besideOf(p);
      page.sources.toggle(page.selected());
      if (together && !page.sources.following) page.papers.win.close();
    } else if (e.key === "Escape") {
      // what passes first: a question about trust, a popover, the views menu or the focus's, a list
      // of the Time Machine; then the source window that follows the selection, the timeline, the
      // Time Machine, and the selection. A pinned window closes by Esc with the focus in it, or by
      // its ✕.
      if (page.trust.open) page.trust.close();
      else if (page.buildPop.open) page.buildPop.toggle(false);
      else if (page.tabs.open) page.tabs.toggle(false);
      else if (page.focusMenu.open) page.focusMenu.toggle(false);
      else if (page.boardPop.open || page.trustPop.open || page.eyesPop.open) for (const p of [page.boardPop, page.trustPop, page.eyesPop]) p.toggle(false);
      else if (page.tm.listShown) page.tm.closeListNow();
      else if (page.sources.following) page.sources.close(page.sources.following);
      else if (page.activity.open) page.activity.toggle(false);
      else if (page.lostDrawer.open) page.lostDrawer.toggle(false);
      else if (page.tm.active) void page.tm.close();
      else if (page.picks.length || page.shown) {
        page.clear();
        page.commit();
      }
    } else if (e.key === "f") page.canvas.fit();
    else if (e.key === "+" || e.key === "=") page.canvas.zoomBy(1.6);
    else if (e.key === "-" || e.key === "_") page.canvas.zoomBy(1 / 1.6);
    else if (e.key === "e") page.toggleOutside();
    else if (e.key === "g") page.edgesBtn.click();
    else if (e.key === "o") page.linear.toggle();
    else if (e.key === "c") page.chooseScheme(page.ownScheme() === "kind" ? "status" : "kind");
    else if (e.key === "l") page.toggleLock();
    else if (e.key === "[") page.canvas.stepLevels(-1);
    else if (e.key === "]") page.canvas.stepLevels(1);
    else if (e.key === "p") {
      // a frame meter, to check the canvas keeps up on this machine
      const m = $("#meter");
      m.hidden = !m.hidden;
      if (!m.hidden) {
        const tick = () => {
          if (m.hidden) return;
          const st = page.canvas.stats();
          m.textContent = `${st.fps} fps · draw ${st.drawMs} ms · ${st.dots} dots · ${st.circles} circles · ${st.bundles} bundles${st.awake ? " · moving" : ""}`;
          setTimeout(tick, 250);
        };
        tick();
      }
    }
    else if (e.key === "b" && !data.snapshot) page.pill.click();
    // the Time Machine (HistorySpec decisions 15–19): t opens it on the view on show — at the build
    // the view is kept at, else the latest — and leaves it; ← and → step from build to build, Home
    // and End go to the first and the last
    else if (e.key === "t" && !data.snapshot && !e.altKey) {
      if (page.tm.active) void page.tm.close();
      else void page.openTimeMachine(page.nav.board.rec.version !== undefined ? { snapshot: page.nav.board.rec.version } : {});
    } else if (page.tm.active && !e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      page.tm.step(e.key === "ArrowLeft" ? -1 : 1);
      page.didTip("first-time-machine");
    } else if (page.tm.active && (e.key === "Home" || e.key === "End")) {
      e.preventDefault();
      page.tm.end(e.key === "End");
    }
    else if ((e.key === "a" || e.key === "m") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
      // the review: approve or comment on the selection, as the buttons in the source window that
      // follows it if that is open, else the panel's (a comment not yet written focuses the box: the
      // key is not typed into it). A comment is m: c is the colour scheme's, and m is a comment's
      // key in Jira, and with Ctrl+Alt in Word and Google Docs. There is no key to walk a review (the
      // owner's decision of 2026-10-12): people go from name to name in the source window.
      e.preventDefault();
      const i = page.selected();
      const f = page.sources.following;
      // a past build is not reviewed: said where the key was pressed, as the review box says it
      if (i !== null && page.pastShown()) page.say(PAST_REVIEW);
      else if (i !== null) page.reviewBox.give(e.key === "a" ? "approve" : "comment", i, f && !f.collapsed ? f.el : $("#panel"));
    }
    else if (e.key === "k" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) page.toggleKey();
    else if (e.key === "?") page.guide.toggleMenu();
  });

  return { searchBox };
}
