// What following carries (CollabSpec decision 4, the owner's decision of 2026-10-11): what you see is
// followed; how you look at it is yours. Every surface of the page is declared here, once, as
// followed or as the reader's own, and both halves of following are read from this one list, so that
// a new surface cannot fall between them:
//
// - what presence carries (shared/collab.ts, PresenceView) is exactly the followed parts' fields, each
//   read by the page and applied to a follower's (web/src/main.ts gives both, typed by this list);
// - what ends following (web/src/people.ts) is a change to a followed part, or acting on what a
//   followed surface shows; nothing done in a surface of the reader's own ends it, nor does reading.
//
// CollabSpec's table "Surfaces" is this list in words. A new surface — a popover, a drawer, a window,
// a key — is declared here before it ships; test/surfaces.test.ts holds every element of the page's
// skeleton (web/index.html) to it.
//
// A share link carries the followed parts too, as a snapshot applied once by the page that opens it
// (CollabSpec decision 7, the owner's decision of 2026-10-12): read here as presence reads them
// (`followedOf`), each in a form of its own (shared/sharesnap.ts), and applied as following applies
// them.

import type { PresenceView } from "../../shared/collab.ts";
import { SNAPSHOT_FORMS } from "../../shared/sharesnap.ts";
import type { SnapForm } from "../../shared/sharesnap.ts";

/** A part of what a reader sees that those following them see too. */
interface Followed {
  part: string;
  /** what it is, in words (CollabSpec's table) */
  what: string;
  /** what presence carries it in */
  fields: readonly (keyof PresenceView)[];
  /** where a press changes it, wherever that is on the page: a control that goes somewhere, a
   *  filter, a switch; or a whole surface where any press moves the reader (the canvas, the tabs) */
  changes?: string;
  /** where it is shown and read: a press there on a control changes it or acts on what it shows,
   *  anywhere else (its text, a scrollbar) is reading */
  reads?: string;
  /** the page's keys that change it, outside a field */
  keys?: readonly string[];
  /** keys that change it from a field of a surface of the reader's own: Enter choosing a search
   *  result goes to it */
  fieldKeys?: readonly { in: string; key: string }[];
  /** where a double-click changes it: a window's title bar collapses the window */
  dblclick?: string;
  /** where the wheel changes it: on the canvas it zooms */
  wheel?: string;
  /** applied with the place, by one step of the page's (web/src/main.ts, `follow`): the view opened
   *  first, then the build, then the camera, tool, selection, focus and visitors, then the windows;
   *  the other parts are applied on their own once the place is reached */
  place?: true;
}

/** A surface of the reader's own: nothing done in it ends following. A control in it that changes a
 *  followed part (a view opened from the Views menu, a search result chosen) is that part's. */
interface Yours {
  id: string;
  what: string;
  /** where it is on the page; absent where there is nothing to press (a scroll position) */
  where?: string;
  /** the page's keys for it, which change nothing followed */
  keys?: readonly string[];
  /** nothing in it ends following, whatever it does — a name in a conversation goes there and the
   *  reader looks aside until the followed reader moves; following ends there only by what is there
   *  to end it (the strip's ✕, the initials clicked again, web/src/people.ts) */
  whole?: true;
}

/** The followed parts, in the order a follower's page applies them. */
export const FOLLOWED = [
  {
    part: "view",
    what: "the view: the board on show (its tab), by its id or its query, with the board's clustering and what the side panel shows of it",
    fields: ["view", "scope", "clusterMode"],
    // the tabs, Back and Forward, a view opened or made from the Views menu; the notes on the board,
    // the board's own, pressed or written
    changes: "#tabs, #nav-back, #nav-fwd, #views-menu [data-open], #views-menu [data-act=create], #views-menu [data-act=duplicate], #stickies, .sticky-editor",
    reads: "#side",
    place: true,
  },
  {
    part: "history",
    what: "the Time Machine: the build browsed, or none",
    fields: ["history"],
    changes: "#tmbar, #tm-kept [data-tm-open], #build-pop [data-bp=tm], #build-pop [data-snapshot]",
    reads: "#tm-kept",
    keys: ["t", "ArrowLeft", "ArrowRight", "Home", "End"],
    place: true,
  },
  {
    part: "camera",
    what: "the camera",
    fields: ["cam"],
    changes: "#canvas, #labels, #cards, #zoom-in, #zoom-out, #zoom-fit",
    keys: ["f", "+", "=", "-", "_"],
    wheel: "#canvas, #labels, #cards",
    place: true,
  },
  {
    part: "tool",
    what: "the tool: Selection, Rests on and its step, Used by",
    fields: ["mode"],
    changes: "#lightup",
    keys: ["1", "2", "3"],
    place: true,
  },
  {
    part: "selection",
    what: "the selection, and going somewhere: a row, a name or a result that goes to a declaration or a cluster",
    fields: ["selection"],
    changes: "#selbar, #ctxmenu, .cm-sub, #results .hit, [data-go], [data-ref], [data-walk], [data-c], [data-module], [data-tm-go], #help [data-help-tour], #linear",
    keys: ["ContextMenu", "F10"],
    fieldKeys: [{ in: "#search", key: "Enter" }],
    place: true,
  },
  {
    part: "focus",
    what: "the reader's own focus on their view, and the review strip it shows",
    fields: ["focus"],
    changes: "#focus-menu [data-focus], #focus-menu [data-back]",
    reads: "#lensbar",
    place: true,
  },
  {
    part: "visitors",
    what: "visitors: declarations gone to that the board does not hold (they come with going somewhere)",
    fields: ["visitors"],
    place: true,
  },
  {
    part: "panel",
    what: "the right panel: what it tells of",
    fields: ["sel"],
    reads: "#panel",
    // approve, comment on, mark key what it tells of
    keys: ["a", "m", "k"],
    place: true,
  },
  {
    part: "sources",
    what: "the source windows: the one following the selection and each pinned one — open, collapsed or not, on what",
    fields: ["source", "sourceCollapsed", "pinned"],
    reads: ".sw-win",
    keys: [" "],
    dblclick: ".sw-win:not(.collapsed) .sw-head",
    place: true,
  },
  {
    part: "paper",
    what: "the reference window: open, collapsed or not, on what file, page and link",
    fields: ["paper"],
    changes: "#library-pop [data-lb-open]",
    reads: ".pw-win",
    dblclick: ".pw-win:not(.collapsed) .pw-head",
    place: true,
  },
  {
    part: "activity",
    what: "Activity: open or closed, and its filters",
    fields: ["activity"],
    changes: "#activity-btn, #activity .act-filters",
    reads: "#activity",
  },
  {
    part: "lostFound",
    what: "the lost-and-found: open or closed (it has no filters)",
    fields: ["lostFound"],
    changes: "#build-pop [data-bp=lost]",
    reads: "#lostfound",
  },
  {
    part: "colouring",
    what: "the colouring: the legend's Kind or Status",
    fields: ["scheme"],
    changes: "#legend [data-scheme]",
    keys: ["c"],
  },
  {
    part: "edges",
    what: "edges drawn, or not",
    fields: ["edges"],
    changes: "#edges-btn",
    keys: ["g"],
  },
  {
    part: "proofEdges",
    what: "proof edges drawn, or not",
    fields: ["proofEdges"],
    changes: "#proofs-btn",
  },
  {
    part: "linear",
    what: "the linear form: the board drawn as its document's outline, or not",
    fields: ["linear"],
    changes: "#linear-btn",
    keys: ["o"],
  },
] as const satisfies readonly Followed[];

/** The surfaces of the reader's own. */
export const YOURS = [
  { id: "windowPlaces", what: "where windows sit and how big they are (a drag on a title bar presses no control; the edges resize)", where: ".fl-rz" },
  { id: "scroll", what: "scroll positions: the wheel off the canvas, a scrollbar" },
  { id: "sections", what: "folded sections of the side panel, the panel and the lost-and-found", where: "[data-sec], #lostfound .lf-archived > summary" },
  { id: "tcbOrder", what: "the TCB list's order", where: "[data-tcb-order]" },
  { id: "outline", what: "the outline's levels opened", where: "#outline .tw" },
  { id: "whatChanged", what: "\"What changed\" opened: the Time Machine's counts and the lists they open", where: "#tmbar .tm-sum, [data-tm-list], #tm-list" },
  { id: "legend", what: "the legend folded or open", where: "#legend" },
  { id: "eyes", what: "the eyes' ⋯ popover, opened", where: "#eyes-btn, #eyes-pop" },
  { id: "artwork", what: "framing an artwork (ExportSpec decision 19): its frame, its size and look, saving it", where: "#art, #art-panel", whole: true },
  { id: "theme", what: "the theme", where: "#theme-seg" },
  { id: "lock", what: "the layout lock", where: "#lock-btn", keys: ["l"] },
  // the box tool (AttachmentSpec decision 5, the owner's decision of 2026-10-12): armed for the
  // reader's own next drag; what they select on a page is reading, which ends nothing
  { id: "paperTools", what: "zoom, find and the box tool in the reference window", where: "[data-pw-zoom], [data-pw-find], [data-pw-box], .pw-find" },
  { id: "share", what: "Share, and its switch Exactly what I see", where: "#share-btn, #share-pop" },
  { id: "export", what: "Export", where: "#export-btn, #export-modal" },
  { id: "help", what: "Help: the ? sheet and the tour", where: "#help-btn, #help, #tour", keys: ["?"] },
  { id: "library", what: "the Library popover", where: "#library-btn, #library-pop" },
  { id: "board", what: "⚙ Board: the board's scope, clustering, depth and Re-layout, shared with everyone on it", where: "#board-btn, #board-pop", keys: ["e", "[", "]"] },
  { id: "trusted", what: "Trusted, and trusting without review", where: "#trusted-btn, #trust-list, #trust-pop" },
  { id: "viewsMenu", what: "the Views menu", where: "#views-btn, #views-menu" },
  { id: "focusMenu", what: "the focus menu, opened", where: "#focus-btn, #focus-menu" },
  { id: "build", what: "the build status and its popover", where: "#build, #build-pop", keys: ["b"] },
  { id: "search", what: "the search box and its results", where: "#search, #results", keys: ["/"] },
  { id: "name", what: "the name, its menu and its window", where: "#who, #who-menu, #modal", whole: true },
  { id: "people", what: "the others' initials and the menu a person's opens — following them, or no longer, and asking them to follow you —, a Shift-click on a pinned agent's that opens its conversation without following, and what your request to follow came to", where: "#peers, #peer-menu, #ask-line", whole: true },
  // a request to follow (CollabSpec decision 10, the owner's decision of 2026-10-12): answering it ends
  // no following, but Follow starts following the asker, as their initials' Follow does
  { id: "askBanner", what: "a request to follow you: its banner, Follow and Not now", where: "#ask-banner", whole: true },
  { id: "conversation", what: "the follower's own conversation window and the following strip (following an agent still opens its conversation)", where: "#following", whole: true },
  // inside the conversation's window, which is the reader's own whole: declared on its own all the
  // same, since it decides what following ending leaves on the screen (web/src/talkpins.ts)
  { id: "talkPin", what: "the conversation's pin: kept per agent in this browser, a pinned conversation stays open when following ends and after a reload", where: "#following [data-pin]" },
  { id: "hoverCards", what: "hover cards", where: ".hcard" },
  { id: "pointer", what: "the pointer's highlight" },
  { id: "meter", what: "the frame meter", keys: ["p"] },
] as const satisfies readonly Yours[];

/** What presence carries that is no surface's state: the views the reader has open, by which the
 *  server keeps a view nobody keeps (server/views.ts). A follower takes nothing of it. */
export const BOOKKEEPING = ["tabs"] as const satisfies readonly (keyof PresenceView)[];

/** The frames the surfaces sit in: their own blank parts are as anywhere else (a press there moves
 *  the reader, as on the canvas), and what is in them is declared each. */
export const FRAMES = ["#bar", "#viewbar", "#foot", "#windows", "#zoom"] as const;
/** Elements of the page's skeleton that are no surface: the bar's words, and what passes —
 *  tooltips, hints, notes of others' changes, the loader. */
export const NOT_SURFACES = ["#project", "#snapshot", "#progress", "#hint", "#mode-tip", "#tip", "#meter", "#notes", "#loader"] as const;

export type Part = (typeof FOLLOWED)[number]["part"];
type Of<P extends Part> = Extract<(typeof FOLLOWED)[number], { part: P }>;
export type FieldsOf<P extends Part> = Of<P>["fields"][number];
/** the parts applied on their own, once the place is reached */
export type OwnPart = Exclude<Part, Extract<(typeof FOLLOWED)[number], { place: true }>["part"]>;

// Every field of PresenceView is carried for one part or is bookkeeping, and nothing else is: a new
// field that no part declares does not typecheck.
type Carried = FieldsOf<Part> | (typeof BOOKKEEPING)[number];
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const exact: Same<Carried, keyof PresenceView> = true;
void exact;
// Every followed part has its form in a share link's snapshot, holding its fields and no other: a part
// declared without one does not typecheck.
const forms: { [P in Part]: SnapForm<FieldsOf<P>> } = SNAPSHOT_FORMS;
const formed: Same<keyof typeof SNAPSHOT_FORMS, Part> = true;
void forms, formed;

/** What the page gives for the followed parts: how each is read into presence, and how a followed
 *  reader's is applied — the place's parts together, by the page's own step, the others each here. */
export interface PageParts {
  read: { [P in Part]: () => Pick<PresenceView, FieldsOf<P>> };
  apply: { [P in OwnPart]: (v: PresenceView) => void };
}

/** What this page shows of the followed parts, each read by the page: what those following see, and
 *  what a share link's snapshot holds. */
export function followedOf(read: PageParts["read"]): Omit<PresenceView, "tabs"> {
  return Object.assign({}, ...FOLLOWED.map((p) => read[p.part]())) as Omit<PresenceView, "tabs">;
}

/** Where this page is, as presence carries it: exactly the followed parts, and the bookkeeping. */
export function presenceOf(read: PageParts["read"], tabs: string[]): PresenceView {
  return { ...followedOf(read), tabs };
}

/** Apply a followed reader's parts that are not the place, each that their page said: one from
 *  before 2026-10-11, or an agent, says none of them, and this reader keeps their own. */
export function applyOwn(v: PresenceView, apply: PageParts["apply"]): void {
  for (const p of FOLLOWED) {
    const fields: readonly (keyof PresenceView)[] = p.fields;
    if ("place" in p || !fields.every((f) => v[f] !== undefined)) continue;
    apply[p.part as OwnPart](v);
  }
}

/** every field presence carries */
export const PRESENCE_FIELDS: readonly (keyof PresenceView)[] = [...FOLLOWED.flatMap((p): (keyof PresenceView)[] => [...p.fields]), ...BOOKKEEPING];

// ------------------------------------------------------------------ what ends following

/** An element of the page as the rule reads it: what it matches, and what holds it. In the tests a
 *  stand-in answers as one does (test/surfaces.test.ts). */
export interface PageEl {
  matches(selectors: string): boolean;
  readonly parentElement: PageEl | null;
}

/** What acts when pressed: a control, or a row or a name that goes somewhere. */
const CONTROL = "button, a[href], input, textarea, select, [data-go], [data-ref], [data-walk], [data-c]";
/** what Enter or Space presses */
const PRESSABLE = "button, a[href], summary, [role=menuitem], [role=menuitemradio], [role=tab]";
const MODIFIERS = ["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock"];

type Verdict = "changes" | "yours" | "reads";
/** Every declared region, a control that changes a followed part first: where one element is
 *  several, the first wins. */
const REGIONS: { sel: string; verdict: Verdict }[] = [
  ...FOLLOWED.flatMap((p): { sel: string; verdict: Verdict }[] => ("changes" in p ? [{ sel: p.changes, verdict: "changes" }] : [])),
  ...YOURS.flatMap((y): { sel: string; verdict: Verdict }[] => ("where" in y ? [{ sel: y.where, verdict: "yours" }] : [])),
  ...FOLLOWED.flatMap((p): { sel: string; verdict: Verdict }[] => ("reads" in p ? [{ sel: p.reads, verdict: "reads" }] : [])),
];
const FOLLOWED_KEYS = new Set<string>(FOLLOWED.flatMap((p) => ("keys" in p ? [...p.keys] : [])));
const YOURS_KEYS = new Set<string>(YOURS.flatMap((y) => ("keys" in y ? [...y.keys] : [])));
const FIELD_KEYS = FOLLOWED.flatMap((p) => ("fieldKeys" in p ? [...p.fieldKeys] : []));
const WHOLE = YOURS.flatMap((y) => ("whole" in y ? [y.where] : [])).join(", ");
const DBLCLICK = FOLLOWED.flatMap((p) => ("dblclick" in p ? [p.dblclick] : [])).join(", ");
/** where the wheel moves the reader: anywhere else it scrolls what is under it */
export const WHEEL = FOLLOWED.flatMap((p) => ("wheel" in p ? [p.wheel] : [])).join(", ");

function closest(t: PageEl | null, sel: string): PageEl | null {
  for (let e = t; e; e = e.parentElement) if (e.matches(sel)) return e;
  return null;
}

/** The innermost declared surface `t` is in, as the rule classes it; null outside every one. Inside
 *  a surface of the reader's own that is theirs whole, whatever is nearer. */
function regionOf(t: PageEl | null): Verdict | null {
  if (closest(t, WHOLE)) return "yours";
  for (let e = t; e; e = e.parentElement) for (const r of REGIONS) if (e.matches(r.sel)) return r.verdict;
  return null;
}

/** Whether `t` is in a surface of the reader's own. */
export function inYours(t: PageEl | null): boolean {
  return regionOf(t) === "yours";
}

/** Whether a press on `t` ends following. Read from the innermost surface it is in: a control that
 *  changes a followed part, anywhere; never in a surface of the reader's own; on a surface that
 *  shows what is followed (the panel, a window, Activity), a control — which changes it, or acts on
 *  what it shows — but not its text, to select it, nor a scrollbar; outside every surface (the bars'
 *  blank parts), any press, as on the canvas. */
export function pressActs(t: PageEl | null): boolean {
  const r = regionOf(t);
  if (r === null || r === "changes") return true;
  if (r === "yours") return false;
  return closest(t, CONTROL) !== null;
}

/** Whether a double-click on `t` ends following: on a window's title bar, off its buttons and links,
 *  it collapses the window; elsewhere it selects a word, or its presses acted already. */
export function doubleClickActs(t: PageEl | null): boolean {
  return closest(t, DBLCLICK) !== null && closest(t, CONTROL) === null;
}

/** What a key event says, as the rule reads it. */
export interface KeyPress {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
}

/** Whether a key pressed at `t` ends following; `field` is whether it is typed into a field. Esc is
 *  apart (web/src/people.ts). Typing into a field of a surface of the reader's own does not (the
 *  search box, a Share field), but Enter choosing a search result does; typing anywhere else does,
 *  so that nothing moves under a comment being written. Enter or Space on a control presses it. With
 *  Ctrl or ⌘ a letter outside a field is the browser's (copy, select all, find). The page's keys for
 *  a followed part act wherever the focus is; in a surface of the reader's own its own keys do not
 *  (the arrows in a menu), nor do the page's keys for one; any other key does. */
export function keyActs(e: KeyPress, t: PageEl | null, field: boolean): boolean {
  if (MODIFIERS.includes(e.key)) return false;
  const yours = inYours(t);
  if (field || e.isComposing) return !yours || (!e.isComposing && FIELD_KEYS.some((k) => k.key === e.key && closest(t, k.in) !== null));
  if ((e.key === "Enter" || e.key === " ") && closest(t, PRESSABLE)) return pressActs(t);
  if ((e.ctrlKey || e.metaKey) && e.key.length === 1) return false;
  if (FOLLOWED_KEYS.has(e.key)) return true;
  if (yours || YOURS_KEYS.has(e.key)) return false;
  return true;
}
