// What the reader is looking at, as it travels in the address (CanvasSpec.md, "Navigation";
// ViewSpec decision 10): the view — by its id, or by its query when nobody keeps it, with the build it
// shows where that is a past one (`at`; the owner's decision of 2026-10-09) — the
// tool (how a click selects, the mode), the selection as the text of its query, and what the panel
// tells of. Names and keys, not numbers, so a link still means the same declarations after the
// graph is read again. A link Share makes may carry after it a snapshot of everything followed
// (`snap=`, shared/sharesnap.ts; the owner's decision of 2026-10-12), which the page applies once
// and never writes back.

import { declPick, readSelection, sameShown, selectionText, shownOf, TOOLS } from "./selection.ts";
import type { Shown, Tool } from "./selection.ts";

export interface ViewState {
  /** the view's id; null with a query, or for the Project */
  view: string | null;
  /** the query of a view nobody keeps (shared/query.ts text form) */
  scope: string | null;
  /** with `scope`: the build the view shows, a snapshot's id (a view made from a board of a past
   *  build); null for the latest */
  version?: number | null;
  /** the tool: how a click selects (the mode buttons) — `plain`, `deps`, `tcb`, `keys` (the three
   *  steps of Rests on; Uses and TCB keep the names they had as modes, so older addresses still
   *  work) or `apps` */
  mode: Tool;
  /** the selection, as the text of its query (web/src/selection.ts); null when nothing is selected */
  picks: string | null;
  /** what the panel tells of: a declaration (`s`) or a cluster (`c`); the address leaves it out
   *  when it is the last pick's root */
  shown: Shown | null;
}

/** The fragment, without the leading '#'. */
export function encodeState(s: ViewState): string {
  const p = new URLSearchParams();
  if (s.view) p.set("v", s.view);
  else if (s.scope) {
    p.set("q", s.scope);
    if (typeof s.version === "number") p.set("at", String(s.version));
  }
  p.set("mode", s.mode);
  if (s.picks) p.set("sel", s.picks);
  const last = shownOf(readSelection(s.picks).at(-1));
  if (s.shown && !sameShown(s.shown, last)) {
    if ("decl" in s.shown) p.set("s", s.shown.decl);
    else p.set("c", s.shown.cluster);
  }
  return p.toString();
}

/** The state a fragment describes, or null when it describes none. An address from before the
 *  selection was picks (`s`, and `f` for each declaration lit) reads as those declarations picked
 *  under its tool. */
export function decodeState(hash: string): ViewState | null {
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!text) return null;
  const p = new URLSearchParams(text);
  // a link written by hand (`#v=review:A.t`) may leave out the tool: TCB, as a page starts
  const mode = (p.get("mode") ?? (["v", "q", "s", "sel", "c"].some((k) => p.has(k)) ? "tcb" : null)) as Tool | null;
  if (!mode || !TOOLS.includes(mode)) return null;
  const s = p.get("s");
  const c = p.get("c");
  const f = p.getAll("f");
  const picks = p.has("sel") ? readSelection(p.get("sel")) : (f.length ? f : s ? [s] : []).map((n) => declPick(mode, n));
  const view = p.get("v");
  const at = Number(p.get("at"));
  return {
    view,
    scope: view ? null : p.get("q"),
    ...(!view && p.has("q") && Number.isInteger(at) && at >= 1 ? { version: at } : {}),
    mode,
    picks: selectionText(picks),
    shown: s ? { decl: s } : c ? { cluster: c } : shownOf(picks.at(-1)),
  };
}
