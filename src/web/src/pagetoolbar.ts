// The toolbar and the reader's eyes: the modes and what each does, the board's clustering and
// depth, the zoom, the theme, the edges, the lock and Re-layout.
//
// A part of the page: web/src/main.ts makes the parts in order, web/src/page.ts says what they share.

import type { ClusterMode } from "../../shared/graph.ts";
import { setOutside, withoutOutside } from "../../shared/query.ts";
import { fixedScope, PROJECT_SCOPE } from "../../shared/views.ts";
import { escapeHtml } from "./highlight.ts";
import { dragKeyName, dragMoves, isDragKey, lockedChoice, setLockedChoice } from "./drag.ts";
import { applyTheme, themeChoices } from "./theme.ts";
import { Popover } from "./popover.ts";
import { enterStep, restsOn, STEPS } from "./selection.ts";
import type { Tool } from "./selection.ts";
import { $, MODE_NAME, MODE_HINT, RESTS_HINT, STEP_HINT } from "./page.ts";
import type { Page } from "./page.ts";

/** What the toolbar gives the page's other parts. */
export interface ToolbarPart {
  toggleOutside: () => void;
  eyesPop: Popover;
  edgesBtn: HTMLElement;
  syncEdges: () => void;
  dragging: () => boolean;
  toggleLock: () => void;
  relayout: () => Promise<void>;
}

export function toolbarPart(page: Page): ToolbarPart {
  const { data, store, S } = page;

  // ---------------------------------------------------------------- toolbar

  /** What a mode does, under its button while the pointer is on it (or it has the focus); null
   *  puts it away. It is said nowhere else: the reader who knows the modes is not told again. Rests
   *  on's button tells of the mode and each of its steps; a step's, of that step. */
  const modeTip = (b: HTMLElement | null) => {
    const tip = $("#mode-tip");
    if (!b) return void (tip.hidden = true);
    if (b.id === "rests-btn") {
      tip.innerHTML =
        `<b>Rests on</b> <span class="muted">· key 2, again for the next step</span><div>${escapeHtml(RESTS_HINT)}</div>` +
        `<ul class="tip-steps">${STEPS.map((m) => `<li><b>${MODE_NAME[m]}</b>: ${escapeHtml(STEP_HINT[m])}${m === "tcb" ? ` <span class="muted">(where it starts)</span>` : ""}</li>`).join("")}</ul>`;
    } else {
      const m = b.dataset.mode as Tool;
      const key = m === "plain" ? "key 1" : m === "apps" ? "key 3" : "a step of Rests on, key 2 steps";
      tip.innerHTML = `<b>${MODE_NAME[m]}</b> <span class="muted">· ${key}</span><div>${escapeHtml(MODE_HINT[m])}</div>`;
    }
    tip.hidden = false;
    const r = b.getBoundingClientRect();
    tip.style.top = `${r.bottom + 8}px`;
    tip.style.left = `${Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, r.left + r.width / 2 - tip.offsetWidth / 2))}px`;
  };
  for (const b of document.querySelectorAll<HTMLElement>("#lightup button")) {
    b.addEventListener("pointerenter", () => modeTip(b));
    b.addEventListener("pointerleave", () => modeTip(null));
    b.addEventListener("focus", () => modeTip(b));
    b.addEventListener("blur", () => modeTip(null));
  }

  for (const b of document.querySelectorAll<HTMLElement>("#lightup [data-mode]")) {
    b.addEventListener("click", () => page.readerMode(b.dataset.mode as Tool));
  }
  // Rests on: entered at the step last used; while it is the mode its steps are beside it
  $("#rests-btn").addEventListener("click", () => {
    if (!restsOn(S.mode)) page.readerMode(enterStep(S.restsOn));
  });
  for (const b of document.querySelectorAll<HTMLElement>("#board-pop [data-cluster]")) {
    b.addEventListener("click", () => void page.sync.setClustering(b.dataset.cluster as ClusterMode));
  }
  /** The outside world on this board or not: a condition of its scope, everyone's (a target's
   *  view's too: ViewSpec decision 28); the Project always holds it (decision 5). */
  const toggleOutside = () => {
    if (fixedScope(page.nav.board.rec)) return page.say(PROJECT_SCOPE);
    void page.sync.setScope(setOutside(page.nav.board.rec.scope, withoutOutside(page.nav.board.rec.scope))).then((why) => why && page.say(why));
  };
  // the depth of the whole board, one level at a time; the level shown is read from the folds, so
  // it stays right after folding by hand
  page.showLevel = () => {
    if (!page.canvas.layout) return;
    const max = page.canvas.maxDepth() + 1;
    const now = page.canvas.openLevels();
    $("#fold-level").textContent = now >= max ? "All open" : `${now} / ${max}`;
    $<HTMLButtonElement>("#fold-less").disabled = now <= 0;
    $<HTMLButtonElement>("#fold-more").disabled = now >= max;
  };
  $("#fold-less").addEventListener("click", () => page.canvas.stepLevels(-1));
  $("#fold-more").addEventListener("click", () => page.canvas.stepLevels(1));
  $("#zoom-in").addEventListener("click", () => page.canvas.zoomBy(1.6));
  $("#zoom-out").addEventListener("click", () => page.canvas.zoomBy(1 / 1.6));
  $("#zoom-fit").addEventListener("click", () => page.canvas.fit());
  applyTheme();
  themeChoices($("#theme-seg"));
  // the lock, the edges and the theme, behind the eyes' ⋯ (decided 2026-10-08); their keys stay
  const eyesPop = new Popover($("#eyes-btn"), $("#eyes-pop"));
  // the reader's eyes, at the bottom right: edges drawn (proof edges are no more: the owner's
  // decision of 2026-10-15)
  const edgesBtn = $("#edges-btn");
  const syncEdges = () => {
    edgesBtn.classList.toggle("on", S.showEdges);
    edgesBtn.setAttribute("aria-pressed", String(S.showEdges));
    // an artwork's, while its mode is on (drawLook)
    page.canvas.setEdges(page.artLook ? page.artLook.edges !== "none" : S.showEdges);
  };
  // what the board draws, which those following this reader see too (CollabSpec decision 4)
  page.setEdges = (edges) => {
    if (edges === S.showEdges) return;
    S.showEdges = edges;
    store.save();
    syncEdges();
    page.people.report();
  };
  edgesBtn.addEventListener("click", () => page.setEdges(!S.showEdges));
  syncEdges();
  // the layout locked, also the reader's own and kept in this browser (web/src/drag.ts): a drag pans
  // the view, never moves a thing, unless the reader lets the lock go (decided 2026-10-09: panning
  // is the default). The drag key — ⌘ on a Mac, where Ctrl+click is the right click, and Ctrl
  // elsewhere — held does the other while it is held; the canvas reads the key at each press, and the
  // button shows which way a drag goes now and names the key.
  const lockBtn = $("#lock-btn");
  page.locked = lockedChoice();
  let held = false;
  /** whether a drag on a declaration, a circle or a note moves it now */
  const dragging = () => dragMoves(page.locked, held);
  const syncLock = () => {
    const on = !dragging();
    lockBtn.classList.toggle("on", on);
    lockBtn.classList.toggle("held", held);
    lockBtn.querySelector(".eye-l")!.textContent = page.locked ? "Layout locked" : "Drag moves nodes";
    // ⋯ says so while a drag moves things, which is not the default and is out of sight behind it,
    // and while the drag key is held
    $("#eyes-btn").classList.toggle("flag", !on);
    $("#eyes-btn").classList.toggle("held", held);
    lockBtn.setAttribute("aria-pressed", String(page.locked));
    page.canvas.setLocked(page.locked);
  };
  const toggleLock = () => {
    page.locked = !page.locked;
    setLockedChoice(page.locked);
    syncLock();
  };
  lockBtn.addEventListener("click", toggleLock);
  lockBtn.title =
    "The lock, on by default: a drag pans the view, never a declaration, a circle or a note; clicks still select. " +
    `Let it go and a drag moves them, for everyone on this board (l). Hold ${dragKeyName()} for the other way while held.`;
  const holding = (e: KeyboardEvent) => isDragKey(e.key);
  window.addEventListener("keydown", (e) => {
    if (holding(e) && !held) {
      held = true;
      syncLock();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (holding(e) && held) {
      held = false;
      syncLock();
    }
  });
  // a key let go elsewhere (another window, another tab) is never heard of
  window.addEventListener("blur", () => {
    if (!held) return;
    held = false;
    syncLock();
  });
  syncLock();
  // a fresh start for everyone on this board: its pins go (in both ways of clustering) and it is
  // laid out anew — the Project's by the server; other boards keep theirs. It is done under a name,
  // and the timeline says whose.
  const relayout = async () => {
    if (page.frozen()) return page.say(page.frozenWhy());
    const title = page.views.title(page.nav.board.id);
    if (!confirm(`Lay "${title}" out afresh for everyone on it? Its pins are dropped, for everyone, and everything on it moves. Other views keep theirs.`)) return;
    if (!data.snapshot && !(await page.people.ensureLayout())) return;
    const r = await page.sync.change("relayout", {});
    if (r.error) page.say(r.error);
    else if (data.snapshot) {
      // no server to send the pins' going back: the board is laid out afresh here
      page.views.ops(page.nav.board.id, [{ op: "clear" }]);
      page.views.memory(page.nav.board.id, page.cm(), null, null);
      void page.nav.redraw();
    }
  };
  $("#relayout").addEventListener("click", () => void relayout());

  return { toggleOutside, eyesPop, edgesBtn, syncEdges, dragging, toggleLock, relayout };
}
