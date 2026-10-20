// What a reader's browser keeps between visits: the reader's own — what is lit, reading preferences,
// their name and whether they are private, the tabs they have open and, per view, where they were on
// it (ViewSpec decision 3).
// What is on a board and how it is arranged — its scope, clustering, pins and folds — is the
// board's, on the server (server/views.ts). Keys are declaration names, so they survive a
// re-extraction that renumbers everything.

import type { Kept } from "./floatwin.ts";
import { declPick, selectionText } from "./selection.ts";
import type { Shown, Tool } from "./selection.ts";
import type { Scheme } from "./status.ts";

/** A view the reader has open: its id, and its query when nobody keeps it (the server forgets a
 *  view nobody keeps once no page has it open; the query opens it again). */
export interface Tab {
  id: string;
  q?: string;
  /** with `q`: the build the view shows (a view made from a board of a past build), by which it is
   *  opened again */
  at?: number;
}

/** Where the reader was on a view: the camera, the tool, what was selected (web/src/selection.ts),
 *  what the panel told of, and the reader's own focus there (ViewSpec decision 28). */
export interface Seen {
  cam: { x: number; y: number; k: number } | null;
  mode: Tool;
  /** the selection, as the text of its query; null when nothing was selected */
  picks: string | null;
  shown: Shown | null;
  /** the reader's own focus: a target's name, or null for none; absent, the view's own */
  focus?: string | null;
}

export interface Saved {
  /** the tool on a view the reader has not been on yet */
  mode: Tool;
  /** the step of Rests on last used (Uses, TCB or Keys), which entering it resumes: a reading
   *  preference (ViewSpec decision 20); TCB until the reader chooses */
  restsOn?: Tool;
  /** a target's TCB in the panel: in review order, its key declarations alone, or by kind as for
   *  any declaration */
  tcbOrder?: "review" | "kind" | "key";
  showEdges: boolean;
  /** the views open as tabs, in order, and the one on show */
  tabs: Tab[];
  active?: string;
  /** per view (by id), where the reader was on it */
  seen: Record<string, Seen>;
  /** the name this reader gives their review opinions (ReviewSpec decision 6, CollabSpec decision 3) */
  reviewer?: string;
  /** the reader is private (CollabSpec decision 8): kept for this browser, every tab of it alike */
  private?: boolean;
  /** the newest event this reader has seen in the timeline (CollabSpec decision 5) */
  activitySeen?: string;
  /** the tour was taken (GuideSpec decision 1) */
  guided?: boolean;
  /** the welcome card was shown, once (GuideSpec decision 1) */
  welcomed?: boolean;
  /** the reader's own "Open in editor" template (shared/editor.ts), over the server's */
  editor?: string;
  /** the sections this reader folded: the side panel's targets and the board's filter, the
   *  panel's parts (web/src/panel.ts, PANEL_SECTIONS) */
  shut?: string[];
  /** the sections folded until the reader opens them (SHUT_FIRST) that this reader opened */
  opened?: string[];
  /** the colour scheme this reader chose, where the review has a focus and on every other board
   *  (CanvasSpec, "Colour schemes"); where none was chosen, the board's default (schemeFor) */
  scheme?: { review?: Scheme; other?: Scheme };
  /** the legend at the bottom left is open */
  legend?: boolean;
  /** the review box's opinions folded to a line each, in every review box (ReviewSpec, "One review
   *  box", the owner's decision of 2026-10-20); shown, each in full with the earlier ones, where absent */
  opinionsFolded?: true;
  /** the Export window's choices last time (web/src/exportmodal.ts): the settings it sets (what a
   *  page before 2026-10-09 kept besides, its targets and preset, is not read) */
  export?: { settings?: Record<string, unknown> };
  /** the artwork's size and look last time (web/src/artframe.ts), read back with care */
  artwork?: Record<string, unknown>;
  /** the conversation window (web/src/chatwin.ts, CollabSpec decision 13): where the reader put it
   *  and how large, and whether it is collapsed; read back with care, as whatever is kept here may be
   *  from an older page. Nothing of the source windows is kept: each opens in the middle of the
   *  screen (decided 2026-10-09) */
  chat?: Kept;
  /** the conversation window left open by the reader, and the channel on show in it (`public`, or an
   *  agent's id in presence) */
  chatOpen?: true;
  chatChannel?: string;
  /** what the reader has seen of each channel: the last message's id, by channel; the public
   *  channel's counts the button's number (web/src/talk.ts) */
  chatSeen?: Record<string, number>;
  /** Share's "Exactly what I see" turned off in this browser: its links carry only the view (the
   *  owner's decision of 2026-10-12, on by default) */
  shareExact?: false;
}

const DEFAULTS: Saved = {
  mode: "tcb",
  showEdges: true,
  tabs: [],
  seen: {},
};

/** how many views the reader's places on them are remembered for */
const SEEN_MAX = 60;

/** The sections folded until the reader opens them: the filter's chips are for changing the board,
 *  which a reader rarely does, and its heading says how much the board holds; the panel's counts,
 *  axioms and TCB list are there when wanted, their headings saying what they hold (decided
 *  2026-10-08, the page made simpler). */
const SHUT_FIRST = ["filter", "p-stats", "p-axioms", "p-tcb"];

export class Store {
  readonly key: string;
  data: Saved;

  constructor(projectRoot: string) {
    this.key = `visualproof:${projectRoot}`;
    let loaded: Partial<Saved> = {};
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) loaded = JSON.parse(raw);
    } catch {
      // private window, blocked storage: the page works, it just does not remember
    }
    // where an older page kept the source window that follows the selection: nothing of it is
    // kept any more, and it goes with the next save
    delete (loaded as { srcwin?: unknown }).srcwin;
    // the lock as an older page kept it, per project: it is the browser's now (web/src/drag.ts),
    // locked unless the reader lets it go, and this goes with the next save
    delete (loaded as { locked?: unknown }).locked;
    // the pairing choice an older page kept: the pairing is always on now (AttachmentSpec decision
    // 8, the owner's of 2026-10-11), and this goes with the next save
    delete (loaded as { paired?: unknown }).paired;
    // the conversations an older page pinned: there are no pins (the conversation window is the
    // reader's own, CollabSpec decision 13, the owner's decision of 2026-10-19), and these go with the
    // next save
    delete (loaded as { talkPins?: unknown }).talkPins;
    delete (loaded as { talkOpen?: unknown }).talkOpen;
    this.data = {
      ...DEFAULTS,
      ...loaded,
      tabs: Array.isArray(loaded.tabs) ? loaded.tabs.filter((t) => t && typeof t.id === "string") : [],
      seen: loaded.seen && typeof loaded.seen === "object" ? loaded.seen : {},
    };
    // places kept before the selection was picks: the declarations lit, picked under the tool
    for (const s of Object.values(this.data.seen) as (Seen & { focus?: unknown; sel?: unknown })[]) {
      if (s.picks !== undefined) continue;
      const names = (Array.isArray(s.focus) ? s.focus : []).filter((n): n is string => typeof n === "string");
      s.picks = selectionText(names.map((n) => declPick(s.mode, n)));
      s.shown = typeof s.sel === "string" ? { decl: s.sel } : null;
      delete s.focus;
      delete s.sel;
    }
  }

  /** Remember where the reader is on view `id`; the views longest unvisited are forgotten. */
  remember(id: string, seen: Seen): void {
    const s = this.data.seen;
    delete s[id];
    s[id] = seen;
    const keys = Object.keys(s);
    for (const k of keys.slice(0, Math.max(0, keys.length - SEEN_MAX))) delete s[k];
    this.save();
  }

  /** Whether a section of the side panel is folded: as the reader left it, or as it starts. */
  isShut(section: string): boolean {
    const d = this.data;
    return (d.shut ?? []).includes(section) || (SHUT_FIRST.includes(section) && !(d.opened ?? []).includes(section));
  }

  /** Fold a section of the side panel, or open it; kept in this browser. */
  toggleShut(section: string): void {
    const d = this.data;
    const shut = this.isShut(section);
    const drop = (xs: string[] | undefined) => (xs ?? []).filter((x) => x !== section);
    d.shut = shut ? drop(d.shut) : [...drop(d.shut), section];
    // a section that starts folded remembers being opened, not only being folded
    if (SHUT_FIRST.includes(section)) d.opened = shut ? [...drop(d.opened), section] : drop(d.opened);
    this.save();
  }

  /** The colour scheme where the review has a focus (`review`) or on any other board: the reader's
   *  choice there — Kind, Status or Mine —, or else Status where the review is done, and Kind
   *  elsewhere. */
  schemeFor(review: boolean): Scheme {
    const s = this.data.scheme?.[review ? "review" : "other"];
    return s === "kind" || s === "status" || s === "mine" ? s : review ? "status" : "kind";
  }

  /** The reader chose a scheme where the review has a focus, or elsewhere: kept for boards of that
   *  kind. */
  setScheme(review: boolean, s: Scheme): void {
    this.data.scheme = { ...this.data.scheme, [review ? "review" : "other"]: s };
    this.save();
  }

  save(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.data));
    } catch {
      // see constructor
    }
  }

  /** Another tab of this browser saved (`raw`, what it wrote under this store's key): whether the
   *  reader is private is the browser's, not the tab's, so this tab takes it — it neither stays
   *  visible nor writes the old choice back with its next save. True when that changed here. What
   *  the reader has seen of the conversations is the browser's too: the furthest of the two, so that
   *  this tab's next save does not undo what was read in another. */
  adopt(raw: string | null): boolean {
    // storage cleared elsewhere says nothing of the reader's choice: a private tab stays private
    if (!raw) return false;
    let other: Partial<Saved> | null;
    try {
      other = JSON.parse(raw);
    } catch {
      return false;
    }
    this.data.chatSeen = seenOf(this.data.chatSeen, other?.chatSeen);
    const p = other?.private === true;
    if (p === (this.data.private === true)) return false;
    this.data.private = p || undefined;
    return true;
  }
}

/** What the reader has seen of the conversations, two tabs' together: the furthest of each channel,
 *  read with care (an older page's, or one edited by hand). */
export function seenOf(a: unknown, b: unknown): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const x of [a, b])
    if (x && typeof x === "object")
      for (const [k, v] of Object.entries(x as Record<string, unknown>)) if (typeof v === "number" && Number.isInteger(v) && v >= 0) out[k] = Math.max(out[k] ?? 0, v);
  return Object.keys(out).length ? out : undefined;
}
