// Where things go on the screen: the conversation window's own place (web/src/chatwin.ts), a
// phone's and an upright monitor's layouts (web/src/phone.ts, web/src/monitor.ts), the room they
// leave the board (the canvas's insets), and what is said for a moment where the hint is.
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import type { Tool } from "./selection.ts";
import { ChatWindow, keepStripClear } from "./chatwin.ts";
import { isPhone, isTall, Phone, tallInsets } from "./phone.ts";
import { MonitorLayout, monitorInsets } from "./monitor.ts";
import { $, TAP_HINT } from "./page.ts";
import type { Page } from "./page.ts";

/** What the layouts give the page's other parts. */
export interface LayoutPart {
  chatWin: ChatWindow;
  syncInsets: () => void;
  say: (text: string) => void;
}

export function layoutPart(page: Page): LayoutPart {
  const { store } = page;

  // the conversation window, the reader's own (web/src/chatwin.ts, CollabSpec decision 13): opened
  // and closed by the reader alone; it starts at the canvas's bottom left, beside the side panel
  const chatWin = new ChatWindow($("#convo"), store, {
    // under the bars, not under the review strip, which comes and goes with the view
    insets: () => ({ left: page.canvas.insets.left, top: $("#viewbar").getBoundingClientRect().bottom + 8 }),
    expanded: () => page.talk.expanded(),
    toggled: (open) => {
      $("#talk-btn").setAttribute("aria-pressed", String(open));
      if (open) $("#talk-notice").hidden = true;
    },
  });
  // the following strip steps aside from it rather than cover its box
  keepStripClear($("#following"), $("#convo"));
  // a phone: the bar's ⋯, the side panel's drawer, the panel's sheet (web/src/phone.ts)
  new Phone({
    closePanel: () => $<HTMLElement>("#panel [data-close]")?.click(),
    resized: () => syncInsets(),
    modeHint: (m) => TAP_HINT[m as Tool] ?? "",
  });
  // an upright monitor: the board above a work area (web/src/monitor.ts)
  new MonitorLayout({ resized: () => syncInsets() });
  const syncInsets = () => {
    const side = $("#side").getBoundingClientRect();
    // the panel, or the timeline's drawer in its place; the selection bar heads that column, which
    // it moves down by its height
    const open = $("#panel").classList.contains("open") || $("#activity").classList.contains("open") || $("#lostfound").classList.contains("open");
    // the review strip, and under it the note of a view kept at a past build: a kept view focused
    // on a target has both (HistorySpec decision 19)
    const height = (id: string) => ($(id).hidden ? 0 : $(id).offsetHeight + 6);
    const lens = height("#lensbar"), kept = height("#tm-kept");
    const strip = lens + kept > 0;
    // the note's height too, where it is the second
    const second = lens && kept;
    const bar = $("#selbar");
    document.body.style.setProperty("--selbar-h", bar.hidden ? "0px" : `${bar.offsetHeight + 8}px`);
    document.body.style.setProperty("--lens-h", `${lens}px`);
    // on a phone the selection bar goes under them both
    document.body.style.setProperty("--strip-h", `${lens + kept}px`);
    // a phone (web/src/phone.ts): the side panel is a drawer, the panel a sheet from the bottom,
    // the selection bar across the top, the legend and the zoom's box at the bottom
    const sheet = $("#panel").classList.contains("open") ? $("#panel").offsetHeight : 0;
    page.canvas.insets = isPhone()
      ? {
          left: 0,
          right: 0,
          top: bar.hidden ? $("#viewbar").getBoundingClientRect().bottom + (strip ? 44 + second : 12) : bar.getBoundingClientRect().bottom + 12,
          bottom: sheet ? sheet + 8 : 56,
        }
      : isTall()
        ? // a tall screen (PhoneSpec, "Tall screens"): the whole width, above the sheet and the dock
          tallInsets()
        : monitorInsets() ?? {
          left: side.width ? side.right + 8 : 0,
          // offsetWidth, not the bounding box: the panel may still be sliding in
          right: open ? $("#panel").offsetWidth + 20 : bar.hidden ? 0 : bar.offsetWidth + 20,
          top: $("#viewbar").getBoundingClientRect().bottom + (strip ? 52 + second : 28),
          bottom: 48,
        };
    // the zoom buttons keep to the canvas's bottom right, the review strip to its middle; where the
    // panel leaves no canvas (a narrow window), there is nothing to zoom
    document.body.style.setProperty("--inset-right", `${page.canvas.insets.right}px`);
    document.body.style.setProperty("--inset-left", `${page.canvas.insets.left}px`);
    $("#zoom").hidden = innerWidth - page.canvas.insets.right - page.canvas.insets.left < 140;
    // the conversation window, where it has not been put by the reader, starts beside the side
    // panel (it does not move while the reader moves it, nor when a source window opens)
    chatWin.layout();
  };
  /** while something is said where the hint is (`say`), until it goes */
  let saying: ReturnType<typeof setTimeout> | null = null;

  /** Something said for a moment where the hint is (below the review strip and the note of a kept
   *  view, where they show): the hint shows nothing otherwise. */
  const say = (text: string) => {
    const hint = $("#hint");
    if (saying) clearTimeout(saying);
    // shown before it is written: a live region in the page when its words change is read out
    hint.hidden = false;
    hint.textContent = text;
    hint.classList.add("say");
    hint.classList.toggle("below", !$("#lensbar").hidden || !$("#tm-kept").hidden);
    saying = setTimeout(() => {
      saying = null;
      hint.hidden = true;
      hint.classList.remove("say", "below");
    }, 3500);
  };

  return { chatWin, syncInsets, say };
}
