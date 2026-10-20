// Views (ViewSpec.md): a view is a board — what is on it (a scope, shared/query.ts) and how it is
// arranged (pins, folds, the clustering, and the notes stuck on it: shared/sticky.ts) are shared by
// everyone on it; the camera, the selection and what is lit are each reader's own. This file holds
// what the server and the pages share: the record of a view, the operations that arrange it
// (applied the same way on both sides, as pins were: shared/places.ts), and the book of views —
// which exist, which are kept, what becomes of them — that the server keeps (server/views.ts) and a
// snapshot keeps in the page.
//
// A board may hide levels of its cluster tree (ViewSpec decision 24), per way of clustering: what a
// hidden cluster holds sits in its parent. Like folds, they are the board's, kept for everyone and
// changed by operations; a fold on a cluster that is hidden goes, since the cluster is not there.
//
// A view may be kept at a past build (HistorySpec decision 19): its `version`, a snapshot's id, set
// by an operation for everyone on it; it then shows that build's graph, read-only.
//
// A view opened from a query (Zoom in, a link, an agent) is only what that query looks like: it is
// not kept, and goes when no page has it open. Opened from a board of a past build, it shows that
// build (its `version`; the owner's decision of 2026-10-09): a view on a query is found by the query
// and the build together. Pinning, folding or naming it keeps it, for
// everyone; deleting a kept view is explicit. The Project view (everything, today's shared pins)
// is always there and cannot be deleted.
//
// A target is linked to at most one view, its view, and a view may be linked to several targets (ViewSpec
// decision 29; the owner's decisions of 2026-10-11): the record's `targets`, in the order they were
// linked. Marking a target makes nothing (the owner's decision of 2026-10-12): a target has no view
// until a click on it opens a view nobody keeps on its TCB, linked to it (`openTarget`) — the link
// lasting as long as that view, kept with it — or someone links it to a view, for everyone, the view
// it leaves keeping its scope and arrangement. Unmarking a target unlinks it alone. A view linked to
// targets is deleted as any kept view is, and its targets then have no view. Nothing makes a target a
// view by itself: not a start, not the targets synced, not a rename. A view named `review:<target>`,
// as marking made them before, is a view as any other.
//
// A view has a focus target, or none (ViewSpec decision 28): where the review works on it. The
// view's own focus is kept with it (`focus`), set when it is made from a target or a focused view,
// and else follows from the rules of `viewFocus`; each reader may focus otherwise for themselves,
// which is the page's (web/src/focus.ts) and never changes the record.
//
// The book also holds the project's notes (AttachmentSpec decisions 13–19, shared/projectnotes.ts):
// kept beside the views, shared as their operations are, and switched with a view's own notes (Only
// in this view, In every view) in one step, so that a note is never in both places nor in none.
//
// Items belong to views as declarations do (the owner's decision of 2026-10-11, shared/items.ts): a
// view keeps the notes of the project added to it and those taken out of it, two lists beside its
// scope, changed by the `item` operation as its pins are. The Project holds every note and keeps no
// lists. A copy of a view has its lists; a copy of the Project has, as added, the notes its scope
// would not give it (`derives`, which the server sets: it reads the graph).

import type { ClusterMode } from "./graph.ts";
import type { BoardMemory } from "./board.ts";
import { applyItemOp, dropItem, invalidItemOp } from "./items.ts";
import type { ItemOp, ViewItems } from "./items.ts";
import { applyOps, CLUSTER_MODES, emptyLayouts, invalidOps } from "./places.ts";
import type { PlaceOp, Pins } from "./places.ts";
import { chainOf, describe, describeCondition, parseQuery, printQuery, readKeys, sameQuery } from "./query.ts";
import type { Query } from "./query.ts";
import { validPersonId } from "./review.ts";
import { applyNoteOp, invalidNoteOp, invalidPlace, MAX_NOTES, NOTE_OPS, stampNoteOp } from "./sticky.ts";
import type { NoteOp, NotePlace, StickyNote } from "./sticky.ts";
import { applyProjectNoteOp, asProjectNote, asViewNote, invalidClusterPlace, MAX_PROJECT_NOTES, stampProjectNoteOp } from "./projectnotes.ts";
import type { ClusterPlace, ProjectNote, ProjectNoteOp } from "./projectnotes.ts";
import { atBuild, lastPart, scopeTitle, TITLE_MAX, withoutBuild } from "./titles.ts";
import type { TitleNames } from "./titles.ts";

export const PROJECT = "project";

export interface ViewData {
  id: string;
  /** what people call it; null where nobody named it (it is shown by its scope) */
  name: string | null;
  scope: Query;
  clustering: ClusterMode;
  /** per way of clustering, as shared/places.ts keeps them */
  pins: Record<ClusterMode, Pins>;
  /** per way of clustering, the keys of the folded clusters */
  folds: Record<ClusterMode, string[]>;
  /** the notes stuck on it (shared/sticky.ts); none where the record predates them */
  notes?: StickyNote[];
  /** per way of clustering, the keys of the hidden levels (ViewSpec decision 24) */
  hidden: Record<ClusterMode, string[]>;
  /** the notes of the project added to it and taken out of it (shared/items.ts); none where both
   *  lists are empty, and never on the Project, which holds every one */
  items?: ViewItems;
  /** who made it, and when */
  by: string | null;
  at: string;
  /** made by an agent; absent where a person made it, or a record older than the mark */
  agent?: true;
  /** made by someone invited by a personal link (CollabSpec decision 9): the link's id, by which they
   *  are named as they are called now; never with an agent's, nor without a name */
  person?: string;
  /** saved for everyone and listed; otherwise it lives while some page has it open */
  kept: boolean;
  /** the targets linked to this view (ViewSpec decision 29), in the order they were linked: clicking
   *  any of them opens this view. A target is linked to one view at most; absent where none is */
  targets?: string[];
  /** the view's focus as set (ViewSpec decision 28): a target's name, or null for none; absent where
   *  nothing set it, and the rules say (`viewFocus`) */
  focus?: string | null;
  /** the build its graph is shown at (HistorySpec decision 19): a snapshot's id; absent, the latest */
  version?: number;
}

/** A view as the list every page holds tells it: no pins, no folds. */
export interface ViewSummary {
  id: string;
  name: string | null;
  /** the scope's text (shared/query.ts) */
  scope: string;
  clustering: ClusterMode;
  kept: boolean;
  /** the targets linked to it (ViewData.targets) */
  targets?: string[];
  /** the view's focus as set (ViewData.focus) */
  focus?: string | null;
  by: string | null;
  at: string;
  /** kept at a past build: the snapshot's id (ViewData.version) */
  version?: number;
  /** its added and taken-out notes (ViewData.items): what Add to view tells of each view */
  items?: ViewItems;
}

export function summary(v: ViewData): ViewSummary {
  return {
    id: v.id,
    name: v.name,
    scope: printQuery(v.scope),
    clustering: v.clustering,
    kept: v.kept,
    ...(v.targets?.length ? { targets: [...v.targets] } : {}),
    ...(v.focus !== undefined ? { focus: v.focus } : {}),
    by: v.by,
    at: v.at,
    ...(v.version !== undefined ? { version: v.version } : {}),
    ...(v.items ? { items: structuredClone(v.items) } : {}),
  };
}

/** The view's focus (ViewSpec decision 28), shared by everyone on it: the target it was focused on
 *  (`focus`, set when it was made from a target or from a focused view, when its first target was
 *  linked, or by hand; null, on none), else the target linked to it first (the owner's decision of
 *  2026-10-11: a view may be several targets'), else the one target the board holds (`held`, the
 *  targets its scope holds now), else none. A focus on what is no target now goes by the next rule. */
export function viewFocus(v: { focus?: string | null; targets?: string[] }, isTarget: (name: string) => boolean, held: () => string[]): string | null {
  if (v.focus === null) return null;
  if (v.focus !== undefined && isTarget(v.focus)) return v.focus;
  const linked = v.targets?.find(isTarget);
  if (linked) return linked;
  const ts = held();
  return ts.length === 1 ? ts[0] : null;
}

/** The focus a new view takes from the view it is made from (Duplicate, a copy without something,
 *  Save as new view): its focus as set, else the target linked to it first, which is its focus to
 *  begin with. Undefined where neither says. */
export const focusFrom = (v: { focus?: string | null; targets?: string[] }): string | null | undefined => (v.focus !== undefined ? v.focus : v.targets?.[0]);

/** The scope of the view a click on a target with no view opens (ViewSpec decision 29, the owner's
 *  decision of 2026-10-11): its TCB, `tcb(T)`, the query Zoom in on the target under Rests on → TCB
 *  makes from the Project (decision 13) — the same whatever board the click came from. */
export const targetScope = (target: string): Query => ({ op: "tcb", of: [target] });

/** What the title of a view is told with (shared/titles.ts): the names of the graph on show, by
 *  which a namespace, a file or a declaration is told apart from the others of its kind, and a build
 *  in a few words ("Oct 9 22:27"), for a view kept at one. Without them, each name is its last part
 *  and a build its snapshot's number. */
export interface TitleContext {
  names?: TitleNames | null;
  build?(snapshot: number): string | null;
}

type Titled = { id: string; name: string | null; targets?: string[]; scope: Query; version?: number };

/** What a view is called on a tab, in a list, in Activity, presence and the agents' answers: its
 *  name, as people gave it; the Project; or, for a view nobody named, its scope in a few words (the
 *  owner's decision of 2026-10-10, shared/titles.ts: "TCB of ns Fermat42"), with the build it is kept
 *  at ("… @ Oct 9 22:27"). Whether a view is linked to targets is said beside its title, by a star
 *  (ViewSpec decision 29), not in it: a target's temporary view reads "★ TCB of T" (the owner's
 *  decision of 2026-10-12). */
export function viewTitle(v: Titled, ctx: TitleContext = {}): string {
  if (v.name) return v.name;
  if (v.id === PROJECT) return "Project";
  if (v.version === undefined) return scopeTitle(v.scope, ctx.names);
  const when = ctx.build?.(v.version) ?? `build ${v.version}`;
  return atBuild(scopeTitle(v.scope, ctx.names, TITLE_MAX - when.length - 3), when);
}

/** What a view on a query is called from the query's text (a tab, or a reader's place, whose view
 *  the list does not hold): its title as a view nobody named, at the build it shows; the text itself
 *  where it cannot be read. */
export function titleOfScope(text: string, ctx: TitleContext = {}, version?: number): string {
  try {
    return viewTitle({ id: "", name: null, scope: parseQuery(text), ...(version !== undefined ? { version } : {}) }, ctx);
  } catch {
    return text;
  }
}

/** What a view's scope holds, in full (shared/query.ts, `describe`): the set it starts from, then
 *  its conditions — what the page shows under the pointer where it shows a title, and agents read as
 *  `description`. */
export function viewDescription(v: { scope: Query }): string {
  // a view of a Keys selection (Zoom in): its and is the one part it is, not a condition
  if (readKeys(v.scope)) return describe(v.scope);
  const { base, conditions } = chainOf(v.scope);
  return [describe(base), ...conditions.map(describeCondition)].join(", ");
}

/** The title of a view's exported document (ExportSpec decision 14): the view's title as it is
 *  named — a name people gave exactly as they wrote it, the Project — and,
 *  for a view nobody named at a past build, with that build as its title says it ("… @ Oct 9
 *  22:27"; decision 16): the document is that build's. A title made from the scope is lower case
 *  only because it is made, and takes a capital as a title does, a namespace written in full
 *  ("Namespace Fermat42"); one that begins with a declaration's name (a view of `decl(…)`) keeps it as
 *  Lean writes it. */
export function docTitle(v: Titled, ctx: TitleContext = {}): string {
  const t = viewTitle(v, ctx);
  if (v.name || v.id === PROJECT) return t;
  if (!readKeys(v.scope) && chainOf(v.scope).base.op === "decl") return t;
  if (t.startsWith("ns ")) return `Namespace ${t.slice(3)}`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The name Save as new view gives the view it makes of view `title` at a build (HistorySpec
 *  decision 19): its title at that build, "Project @ Oct 9 22:27" — a build the view's own name
 *  ended with replaced — and a number where another view has that name. */
export function versionName(title: string, when: string, taken: ReadonlySet<string>): string {
  const base = atBuild(withoutBuild(title), when);
  let name = base;
  for (let k = 2; taken.has(name); k++) name = `${base} (${k})`;
  return name;
}

/** Who did something to a view, as its record and its pins' authors keep it: a name (null where none
 *  was given, as a private reader's), whether an agent did, and the personal link of someone invited
 *  by one — only with a name, and never an agent's. */
export interface Who {
  by: string | null;
  agent?: boolean;
  person?: string | null;
}

/** The marks a record keeps of `who` beside its name: `agent`, and `person` where it may be. */
export function marksOf(who: Who | undefined): { agent?: true; person?: string } {
  if (!who) return {};
  if (who.agent) return { agent: true };
  return who.by && validPersonId(who.person) ? { person: who.person } : {};
}

/** Why target `target` cannot be linked to view `v`, or null (ViewSpec decision 29). The Project is
 *  everyone's way in, no target's; a view kept at a past build is not reviewed. A view linked to
 *  other targets takes one more (the owner's decision of 2026-10-11). */
export function linkRefused(v: { id: string; version?: number }, target: string): string | null {
  const t = lastPart(target);
  if (v.id === PROJECT) return `The Project is everyone's way in, no target's: link ★${t} to another view.`;
  if (v.version !== undefined) return `This view shows a past build, where nothing is reviewed: ★${t}'s view shows the latest build.`;
  return null;
}

/** A view whose scope stays as it is: the Project, everything (ViewSpec decisions 5 and 22), where
 *  Remove from this view makes a copy without it instead. Every other view's scope can change, a
 *  target's view's too (decision 28). */
export const fixedScope = (v: { id: string }): boolean => v.id === PROJECT;

/** Why the Project's scope is not changed (ViewSpec decision 5: never rescoped, the outside world
 *  included). */
export const PROJECT_SCOPE = "The Project always holds everything: Duplicate it for a board that holds less.";

/** Why a view cannot be kept at a past build, or null. The Project and a target's view always show
 *  the latest: the one is everyone's way in, and on the other the review is given, which a past
 *  graph cannot take; Save as new view keeps a build in a view of its own. */
export function versionRefused(v: { id: string; targets?: string[] }): string | null {
  return v.id === PROJECT || v.targets?.length ?"The Project and a target's view always show the latest build: Save as new view keeps this one in a view of its own." : null;
}

/** Why notes of the project cannot be added to view `v` or taken out of it, or null: the Project holds
 *  every one, so there a note is deleted, not taken out; and what is added or taken out is a note of
 *  the project (`isNote`). Taking an id off the lists is always taken. */
export function itemsRefused(v: { id: string }, ops: readonly ItemOp[], isNote: (id: string) => boolean): string | null {
  if (fixedScope(v)) return "The Project holds every note of the project: there a note is deleted, not added or taken out.";
  const stray = ops.find((o) => o.in !== null && !isNote(o.note));
  return stray ? `There is no note ${stray.note} of the project: GET /api/agent/notes?all=1 lists them.` : null;
}

/** A snapshot's id as a view's version: a whole number from 1. */
export const validVersion = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x > 0 && x < 1e9;

/** Who dropped a pin: a name (null where a page gave none), whether an agent did, and when. The
 *  server keeps it beside each view's pins, so that an agent laying out can be told whose pins it
 *  would crowd (server/agentplaces.ts, `place`); the pages are not sent it. The shape server/places.ts
 *  gives it. */
export interface PinAuthor {
  by: string | null;
  agent?: true;
  /** someone invited by a personal link: the link's id (CollabSpec decision 9) */
  person?: string;
  at: string;
}

export type PinAuthors = Record<ClusterMode, { nodes: Record<string, PinAuthor>; clusters: Record<string, PinAuthor> }>;

export const noAuthors = (): PinAuthors => ({ namespace: { nodes: {}, clusters: {} }, module: { nodes: {}, clusters: {} } });

/** The authors of `pins` as read back from disk: one kept only for a pin there is. */
export function cleanAuthors(raw: unknown, pins: Record<ClusterMode, Pins>): PinAuthors {
  const out = noAuthors();
  const a = raw && typeof raw === "object" ? (raw as Partial<PinAuthors>) : {};
  for (const m of CLUSTER_MODES)
    for (const kind of ["nodes", "clusters"] as const)
      for (const [key, who] of Object.entries(a[m]?.[kind] ?? {}))
        if (Object.hasOwn(pins[m][kind], key) && who && typeof who === "object" && typeof who.at === "string") out[m][kind][key] = who;
  return out;
}

/** What arranges a view: pins dropped and let go (shared/places.ts), folds, levels hidden or shown
 *  again (`hide`, `on` false to show), its notes (shared/sticky.ts), the build its graph is shown at
 *  (`version`: a snapshot's id, null for the latest; HistorySpec decision 19), and the notes of the
 *  project added to it or taken out of it (`item`, shared/items.ts). */
export type ViewOp =
  | PlaceOp
  | { op: "fold"; mode: ClusterMode; key: string; on: boolean }
  | { op: "hide"; mode: ClusterMode; key: string; on: boolean }
  | { op: "version"; snapshot: number | null }
  | NoteOp
  | ItemOp;

const isNoteOp = (o: { op: string }): o is NoteOp => (NOTE_OPS as readonly string[]).includes(o.op);

/** the most levels a board hides by one clustering */
export const MAX_HIDDEN = 2000;

/** Why a list of operations is refused, or null. */
export function invalidViewOps(ops: unknown): string | null {
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > 4000) return "ops";
  const places: unknown[] = [];
  for (const o of ops as Record<string, unknown>[]) {
    if (!o || typeof o !== "object") return "op";
    if (isNoteOp(o as { op: string })) {
      const why = invalidNoteOp(o);
      if (why) return why;
      continue;
    }
    if (o.op === "version") {
      if (o.snapshot !== null && !validVersion(o.snapshot)) return "snapshot";
      continue;
    }
    if (o.op === "item") {
      const why = invalidItemOp(o);
      if (why) return why;
      continue;
    }
    if (o.op !== "fold" && o.op !== "hide") {
      places.push(o);
      continue;
    }
    if (!CLUSTER_MODES.includes(o.mode as ClusterMode)) return "mode";
    if (typeof o.key !== "string" || !o.key || o.key.length > 2000) return "key";
    if (typeof o.on !== "boolean") return "on";
  }
  return places.length ? invalidOps(places) : null;
}

/** Apply operations to a view's arrangement in place; true when anything changed. A clear drops
 *  the pins (Re-layout), not the folds, the hidden levels, the notes, the items nor the version.
 *  Hiding a level drops its fold; a fold on a hidden level is not taken, as nobody can fold what the
 *  board does not show. */
export function applyViewOps(
  v: { pins: Record<ClusterMode, Pins>; folds: Record<ClusterMode, string[]>; hidden: Record<ClusterMode, string[]>; notes?: StickyNote[]; version?: number; items?: ViewItems },
  ops: ViewOp[],
): boolean {
  let changed = false;
  const places: PlaceOp[] = [];
  const flush = () => {
    if (places.length && applyOps(v.pins, places.splice(0))) changed = true;
  };
  for (const o of ops) {
    if (isNoteOp(o)) {
      if (applyNoteOp((v.notes ??= []), o)) changed = true;
      continue;
    }
    if (o.op === "item") {
      if (applyItemOp(v, o)) changed = true;
      continue;
    }
    if (o.op === "version") {
      if ((v.version ?? null) === o.snapshot) continue;
      if (o.snapshot === null) delete v.version;
      else v.version = o.snapshot;
      changed = true;
      continue;
    }
    if (o.op !== "fold" && o.op !== "hide") {
      places.push(o);
      continue;
    }
    flush();
    if (o.op === "hide") {
      const hid = v.hidden[o.mode];
      if (o.on && !hid.includes(o.key) && hid.length < MAX_HIDDEN) {
        hid.push(o.key);
        v.folds[o.mode] = v.folds[o.mode].filter((k) => k !== o.key);
      } else if (!o.on && hid.includes(o.key)) v.hidden[o.mode] = hid.filter((k) => k !== o.key);
      else continue;
      changed = true;
      continue;
    }
    if (o.on && v.hidden[o.mode].includes(o.key)) continue;
    const now = v.folds[o.mode];
    const has = now.includes(o.key);
    if (o.on && !has) now.push(o.key);
    else if (!o.on && has) v.folds[o.mode] = now.filter((k) => k !== o.key);
    else continue;
    changed = true;
  }
  flush();
  return changed;
}

/** The fold operations that turn one set of folded keys into another. */
export function diffFolds(mode: ClusterMode, before: string[], after: string[]): ViewOp[] {
  const a = new Set(after), b = new Set(before);
  return [...before.filter((k) => !a.has(k)).map((key) => ({ op: "fold" as const, mode, key, on: false })), ...after.filter((k) => !b.has(k)).map((key) => ({ op: "fold" as const, mode, key, on: true }))];
}

/** A view's name: 1–80 characters, no line breaks or other control characters. */
export function validViewName(s: unknown): s is string {
  return typeof s === "string" && s.trim() === s && s.length > 0 && s.length <= 80 && !/[\u0000-\u001f\u007f]/.test(s);
}

/** What changed in the book, for the pages (and the notes they show) and the timeline. */
export interface Change {
  id: string;
  what: "opened" | "kept" | "renamed" | "deleted" | "scope" | "clustering" | "relayout" | "gone" | "version" | "focus" | "linked" | "unlinked";
  by: string | null;
  /** linked (ViewSpec decision 29): the target linked to the view now; unlinked: the target whose
   *  link left it (to another view, or with its marking) */
  target?: string;
  /** linked to a view nobody keeps by a click on a target with no view (`openTarget`): no event of
   *  the timeline and no note on the board, as opening a view is neither */
  temporary?: true;
  /** deleted, or gone (nobody kept it): the targets the view was linked to, which have no view now
   *  (the owner's decisions of 2026-10-11) */
  targets?: string[];
  /** a rename or a deletion: the name before */
  was?: string | null;
  /** a deletion: the scope the view had, by which the timeline tells a view nobody named */
  scope?: string;
  /** kept at a past build (`version`): the snapshot, or null for the latest again */
  snapshot?: number | null;
}

const empty = (): Record<ClusterMode, string[]> => ({ namespace: [], module: [] });
const newId = () => "v" + Math.random().toString(36).slice(2, 9);

/**
 * Which views exist and what they hold. Pure: the server (server/views.ts) keeps it on disk and
 * tells the pages; a snapshot keeps one in the page. Every method that refuses says why, as text.
 */
export class ViewBook {
  readonly views = new Map<string, ViewData>();
  /** the layout's memory, per view and way of clustering (shared/board.ts) */
  readonly memory = new Map<string, Partial<Record<ClusterMode, BoardMemory>>>();
  /** who dropped each pin, per view (PinAuthor); a pin dropped before the server kept this has
   *  none */
  readonly authors = new Map<string, PinAuthors>();
  /** the project's notes (shared/projectnotes.ts), in the order they were written */
  readonly notes: ProjectNote[];
  /** an open view nobody keeps: when a page last had it open */
  private seenAt = new Map<string, number>();
  /** Which notes a board of view `v` gives from what follows from its scope alone (shared/noteplace.ts,
   *  derivesOn), read on the graph on show: what a copy of the Project leaves out of its added
   *  notes. Set by the server; null where nothing reads a graph (a copy of the Project then takes
   *  none as added). */
  derives: ((v: Pick<ViewData, "scope" | "clustering" | "version">) => ((n: ProjectNote) => boolean) | null) | null = null;

  constructor(views: ViewData[] = [], notes: ProjectNote[] = []) {
    for (const v of views) this.views.set(v.id, v);
    this.notes = notes;
    this.project();
  }

  /** The project's notes changed by `ops`, written and edited by `who` where it is known; the
   *  operations are stamped in place with who and when, so that what is sent on is what was
   *  applied. Whether anything changed. */
  noteOps(ops: ProjectNoteOp[], who?: Who): boolean {
    const at = new Date().toISOString();
    let changed = false;
    for (const o of ops) {
      stampProjectNoteOp(o, who, at);
      if (applyProjectNoteOp(this.notes, o)) changed = true;
    }
    return changed;
  }

  /** Make a note of the project view `view`'s own (`to` "view": Only in this view), at `place`, where
   *  it is on that view's board; or make view `view`'s note the project's (`to` "project": In every
   *  view), at `place` under that board's clustering `mode`. Its text, author, state and what it
   *  carries are kept, and no one becomes its author by switching it. A note made a view's is work on
   *  that board, as a note written there is: a view nobody kept is kept by it (`by`); it leaves every
   *  view's lists (`drops`). A note made the project's is added to the view it was switched on, so
   *  that it stays on that board. The operations that do it, for the pages — on the project's notes
   *  and on the view's — and what changed in the book; or why not. */
  switchNote(
    id: string,
    view: string,
    to: "view" | "project",
    place: NotePlace | ClusterPlace,
    mode: ClusterMode,
    by: string | null = null,
  ): { notes: ProjectNoteOp[]; view: ViewOp[]; changes: Change[]; drops: { view: string; op: ItemOp }[] } | string {
    const v = this.find(view);
    if (typeof v === "string") return v;
    if (to === "view") {
      const n = this.notes.find((x) => x.id === id);
      if (!n) return `The project has no note ${id}.`;
      if (invalidPlace(place)) return "place is a view note's place: {mode, in, world}.";
      if ((v.notes?.length ?? 0) >= MAX_NOTES) return `This view holds ${MAX_NOTES} notes already.`;
      if (v.notes?.some((x) => x.id === id)) return `This view has a note ${id} already.`;
      const out = { notes: [{ op: "pnote-delete" as const, id }], view: [{ op: "note" as const, note: asViewNote(n, place as NotePlace) }] as ViewOp[], changes: v.kept ? [] : [this.keep(v, by)], drops: [] as { view: string; op: ItemOp }[] };
      applyProjectNoteOp(this.notes, out.notes[0]);
      applyViewOps(v, out.view);
      // no longer the project's: no view's lists name it (shared/items.ts)
      out.drops = this.dropItems(id);
      return out;
    }
    const n = v.notes?.find((x) => x.id === id);
    if (!n) return `View ${view} has no note ${id}.`;
    if (invalidClusterPlace(place)) return "place is a project note's place under the board's clustering: {in: [[key, x, y], …]} or {ring: degrees}.";
    if (this.notes.length >= MAX_PROJECT_NOTES) return `The project holds ${MAX_PROJECT_NOTES} notes already.`;
    if (this.notes.some((x) => x.id === id)) return `The project has a note ${id} already.`;
    // made the project's on this board, it stays on it whatever the board holds: added to the view
    // (the Project holds it already)
    const ops: ViewOp[] = [{ op: "note-delete", id }, ...(v.id === PROJECT ? [] : [{ op: "item" as const, note: id, in: "add" as const }])];
    const out = { notes: [{ op: "pnote" as const, note: asProjectNote(n, mode, place as ClusterPlace) }], view: ops, changes: [] as Change[], drops: [] as { view: string; op: ItemOp }[] };
    applyProjectNoteOp(this.notes, out.notes[0]);
    applyViewOps(v, out.view);
    return out;
  }

  /** Note `id` is no longer the project's (deleted, or made a view's own): taken off every view's
   *  lists. The operations that did it, by view, for the pages. */
  dropItems(id: string): { view: string; op: ItemOp }[] {
    const out = dropItem(this.views.values(), id);
    for (const d of out) applyViewOps(this.views.get(d.view)!, [d.op]);
    return out;
  }

  /** Notes of the project just written in view `view` (Add a note here, a file dropped or pasted, Clip
   *  to a note, while that view is on show): added to it, so that it shows them wherever they are
   *  put, as work on that board — a view nobody kept is kept by it. Nothing on the Project, which
   *  holds every note, and nothing for what is no note of the project. The operations and what
   *  changed in the book, or null where nothing did. */
  written(view: string, ids: readonly string[], by: string | null, who?: Who): { ops: ViewOp[]; changes: Change[] } | null {
    const v = this.views.get(view);
    if (!v || v.id === PROJECT) return null;
    const ops: ViewOp[] = ids.filter((id) => this.notes.some((n) => n.id === id)).map((id) => ({ op: "item", note: id, in: "add" }));
    if (!ops.length) return null;
    const r = this.arrange(v.id, ops, by, who);
    return r === null || typeof r === "string" ? null : { ops, changes: r };
  }

  /** The Project view: everything, with its shared pins (ViewSpec decision 5). */
  project(): ViewData {
    let p = this.views.get(PROJECT);
    if (!p) {
      p = { id: PROJECT, name: null, scope: { op: "all" }, clustering: "namespace", pins: emptyLayouts(), folds: empty(), hidden: empty(), by: null, at: new Date(0).toISOString(), kept: true };
      this.views.set(PROJECT, p);
    }
    return p;
  }

  get(id: string): ViewData | undefined {
    return this.views.get(id);
  }

  /** Every view: the Project first, then the targets' views by the target linked to each first, then
   *  the rest by when they were made. */
  list(): ViewData[] {
    const first = (v: ViewData) => v.targets?.[0];
    const rank = (v: ViewData) => (v.id === PROJECT ? 0 : first(v) ? 1 : 2);
    return [...this.views.values()].sort((a, b) => {
      const ta = first(a), tb = first(b);
      return rank(a) - rank(b) || (ta && tb && ta !== tb ? (ta < tb ? -1 : 1) : a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
    });
  }

  kept(): ViewData[] {
    return this.list().filter((v) => v.kept);
  }

  /** A view on a query: the open one nobody keeps that has the same scope and shows the same build,
   *  or a new one, made by `by` (with its marks, `agent` and `person`: an agent, a personal link).
   *  `version`: the build it shows — what is made from a board of a past build keeps that build
   *  (the owner's decision of 2026-10-09) — absent for the latest; `clustering`: a new one's (a
   *  cluster's Zoom in keeps the board's), else by namespace; `focus`: a new one's focus (ViewSpec
   *  decision 28), the target it is made from (a target's Key view) or the focus of the view a Zoom
   *  in came from. */
  open(
    scope: Query,
    by: string | null,
    now = Date.now(),
    opts: { version?: number; clustering?: ClusterMode; focus?: string } & Omit<Who, "by"> = {},
  ): { view: ViewData; change: Change | null } {
    const version = opts.version ?? null;
    for (const v of this.views.values()) {
      if (!v.kept && sameQuery(v.scope, scope) && (v.version ?? null) === version) {
        this.seenAt.set(v.id, now);
        return { view: v, change: null };
      }
    }
    const v: ViewData = {
      id: this.fresh(),
      name: null,
      scope,
      clustering: opts.clustering ?? "namespace",
      pins: emptyLayouts(),
      folds: empty(),
      hidden: empty(),
      by,
      at: new Date(now).toISOString(),
      ...marksOf({ by, agent: opts.agent, person: opts.person }),
      kept: false,
      ...(version !== null ? { version } : {}),
      ...(opts.focus ? { focus: opts.focus } : {}),
    };
    this.views.set(v.id, v);
    this.seenAt.set(v.id, now);
    return { view: v, change: { id: v.id, what: "opened", by } };
  }

  /** A new kept view, named: on `scope`, or a copy of view `from` (its scope, clustering, pins,
   *  folds, hidden levels, version and focus, `focusFrom` — a board of one's own to arrange, no
   *  target's); a copy given a `scope` too holds that one instead, arranged as the view it was
   *  copied from (the canvas's menu: a copy of the Project without what was removed). `version`: the
   *  build it shows (Save as new view, HistorySpec decision 19), null for the latest; left out, the
   *  copied view's. `agent` and `person`: who `by` is, as the record keeps it. */
  create(name: string, by: string | null, opts: { scope?: Query; clustering?: ClusterMode; from?: string; version?: number | null; agent?: boolean; person?: string | null } = {}): ViewData | string {
    if (!validViewName(name)) return "A view's name is 1 to 80 characters, without line breaks.";
    const src = opts.from !== undefined ? this.views.get(opts.from) : undefined;
    if (opts.from !== undefined && !src) return `There is no view ${opts.from}.`;
    if (opts.version !== undefined && opts.version !== null && !validVersion(opts.version)) return "A version is a snapshot's id (GET /api/history lists them), or null for the latest build.";
    const version = opts.version === undefined ? src?.version : opts.version ?? undefined;
    const v: ViewData = {
      id: this.fresh(),
      name,
      scope: opts.scope ?? (src ? structuredClone(src.scope) : { op: "all" }),
      clustering: opts.clustering ?? src?.clustering ?? "namespace",
      pins: src ? structuredClone(src.pins) : emptyLayouts(),
      folds: src ? structuredClone(src.folds) : empty(),
      // a copy is the board it was copied from, its notes on it, and what it shows of the
      // project's: its added and taken-out notes, or, from the Project, what it would not give
      ...(src?.notes?.length ? { notes: structuredClone(src.notes) } : {}),
      ...this.copiedItems(src),
      hidden: src ? structuredClone(src.hidden) : empty(),
      by,
      at: new Date().toISOString(),
      ...marksOf({ by, agent: opts.agent, person: opts.person }),
      kept: true,
      ...(version !== undefined ? { version } : {}),
    };
    const focus = src ? focusFrom(src) : undefined;
    if (focus !== undefined) v.focus = focus;
    this.views.set(v.id, v);
    if (src) {
      // the copy starts from the picture it was copied from, its pins still theirs who dropped them
      const m = this.memory.get(src.id);
      if (m) this.memory.set(v.id, structuredClone(m));
      const a = this.authors.get(src.id);
      if (a) this.authors.set(v.id, structuredClone(a));
    }
    return v;
  }

  /** What a copy of view `src` holds of the project's notes besides what its scope gives: the lists
   *  of `src`; from the Project, which holds every note, the notes a view of its scope would not
   *  give, as added (the owner's decision of 2026-10-11) — reckoned on the Project's scope, so that a
   *  copy without something (New view without it…) leaves out the notes about it with it. */
  private copiedItems(src: ViewData | undefined): { items?: ViewItems } {
    if (!src) return {};
    if (src.id !== PROJECT) return src.items ? { items: structuredClone(src.items) } : {};
    const gives = this.derives?.(src);
    const add = gives ? this.notes.filter((n) => !gives(n)).map((n) => n.id) : [];
    return add.length ? { items: { add, remove: [] } } : {};
  }

  private fresh(): string {
    let id = newId();
    while (this.views.has(id)) id = newId();
    return id;
  }

  private find(id: string): ViewData | string {
    return this.views.get(id) ?? `There is no view ${id}: it was deleted, or it was not kept and every page closed it.`;
  }

  /** Name a view (which keeps it), or take a kept view's name away (null). */
  rename(id: string, name: string | null, by: string | null): Change[] | string {
    const v = this.find(id);
    if (typeof v === "string") return v;
    if (v.id === PROJECT) return "The Project keeps its name.";
    if (name !== null && !validViewName(name)) return "A view's name is 1 to 80 characters, without line breaks.";
    if (name === v.name) return [];
    const was = v.name;
    v.name = name;
    const out: Change[] = [];
    if (!v.kept && name !== null) out.push(this.keep(v, by));
    out.push({ id, what: "renamed", by, was });
    return out;
  }

  /** Delete a kept view: explicit, and never the Project. A view targets are linked to is deleted as
   *  any is, and unlinks them all, which then have no view (the owner's decisions of 2026-10-11): the
   *  deletion says which (`targets`), so that the timeline tells both in one event. */
  remove(id: string, by: string | null): Change | string {
    const v = this.find(id);
    if (typeof v === "string") return v;
    if (v.id === PROJECT) return "The Project cannot be deleted.";
    if (!v.kept) return "This view is not kept: it goes when the last page closes it.";
    this.forget(id);
    return { id, what: "deleted", by, was: v.name, scope: printQuery(v.scope), ...(v.targets?.length ? { targets: [...v.targets] } : {}) };
  }

  /** A view's scope changed by `by`. A scope changed is work done on the board, as a pin dropped is:
   *  a view not kept yet is kept by it (ViewSpec decision 6), so that what was added to it or taken
   *  out of it from the canvas's menu outlives the pages that had it open. A rename carried into the
   *  scope (`keep` false: server/views.ts, moveDeclaration) is no one's work and keeps nothing. The
   *  Project's scope stays `all` (ViewSpec decision 5), whoever asks: the page, an agent, a
   *  snapshot. */
  setScope(id: string, scope: Query, by: string | null, keep = true): Change[] | string | null {
    const v = this.find(id);
    if (typeof v === "string") return v;
    if (fixedScope(v)) return sameQuery(v.scope, scope) ? null : PROJECT_SCOPE;
    if (sameQuery(v.scope, scope)) return null;
    v.scope = scope;
    const change: Change = { id, what: "scope", by };
    return v.kept || !keep ? [change] : [change, this.keep(v, by)];
  }

  /** A view's own focus set by `by` (ViewSpec decision 28): a target's name, or null for none, for
   *  everyone on it; each reader's own focus is left as it is. Work on the board, as a scope changed
   *  is: a view not kept yet is kept by it. A rename carried into it (`keep` false) keeps nothing. */
  setFocus(id: string, focus: string | null, by: string | null, keep = true): Change[] | string | null {
    const v = this.find(id);
    if (typeof v === "string") return v;
    if (v.focus === focus) return null;
    v.focus = focus;
    const change: Change = { id, what: "focus", by };
    return v.kept || !keep ? [change] : [change, this.keep(v, by)];
  }

  /** The view target `target` is linked to (ViewSpec decision 29), or undefined: it has none. */
  viewOf(target: string): ViewData | undefined {
    for (const v of this.views.values()) if (v.targets?.includes(target)) return v;
    return undefined;
  }

  /** Link target `target` to view `id`, for everyone (ViewSpec decision 29): the target's clicks open
   *  it. A view linked to other targets takes it too (the owner's decision of 2026-10-11); a view's
   *  first target is its focus to begin with, and a target linked after leaves its focus as it is. The
   *  view the target leaves keeps its scope, arrangement and focus, and only stops being the target's.
   *  Linking keeps a view nobody kept, and with it its other links. Whether `target` is a target is
   *  the caller's to say. */
  link(id: string, target: string, by: string | null): Change[] | string | null {
    const v = this.find(id);
    if (typeof v === "string") return v;
    const no = linkRefused(v, target);
    if (no) return no;
    if (v.targets?.includes(target)) return null;
    const out: Change[] = [];
    const was = this.viewOf(target);
    if (was) out.push(this.unlink(was, target, by));
    // saved for everyone first, as the timeline tells it, then the target's
    if (!v.kept) out.push(this.keep(v, by));
    v.targets = [...(v.targets ?? []), target];
    if (v.targets.length === 1) v.focus = target;
    out.push({ id: v.id, what: "linked", by, target });
    return out;
  }

  /** Target `target` off view `v`, where a link moved it to another view: the view keeps its scope
   *  and arrangement, and its focus — on the target as it was, where it was the view's first target
   *  and nothing else set its focus. */
  private unlink(v: ViewData, target: string, by: string | null): Change {
    if (v.focus === undefined && v.targets?.[0] === target) v.focus = target;
    this.drop(v, target);
    return { id: v.id, what: "unlinked", by, target };
  }

  /** Target `target` taken off view `v`'s links, and the list with it where it was the last. */
  private drop(v: ViewData, target: string): void {
    const left = (v.targets ?? []).filter((t) => t !== target);
    if (left.length) v.targets = left;
    else delete v.targets;
  }

  /** The view a click on target `target` opens (ViewSpec decision 29, the owner's decision of
   *  2026-10-11): the one it is linked to; where it has none, a view nobody keeps of its TCB, as Zoom
   *  in on it under Rests on → TCB makes from the Project (`targetScope`, by namespace, at the latest
   *  build: `open`), found open or made, linked to it and focused on it where it is its first target.
   *  The link keeps nothing: it lasts as long as the view, which is not written down while nobody
   *  keeps it, so that when the view goes — or the server starts again — the target has none again;
   *  keeping the view keeps the link (`keep`). Made by `by` (with its marks: an agent, a personal link); whether `target` is a target
   *  is the caller's to say. */
  openTarget(target: string, by: string | null, now = Date.now(), who: Omit<Who, "by"> = {}): { view: ViewData; changes: Change[] } {
    const have = this.viewOf(target);
    if (have) {
      if (!have.kept) this.seenAt.set(have.id, now);
      return { view: have, changes: [] };
    }
    const { view, change } = this.open(targetScope(target), by, now, { focus: target, ...who });
    view.targets = [...(view.targets ?? []), target];
    if (view.targets.length === 1) view.focus = target;
    return { view, changes: [...(change ? [change] : []), { id: view.id, what: "linked", by, target, temporary: true }] };
  }

  setClustering(id: string, mode: ClusterMode, by: string | null): Change | string | null {
    const v = this.find(id);
    if (typeof v === "string") return v;
    if (!CLUSTER_MODES.includes(mode)) return "The clustering is namespace or module.";
    if (v.clustering === mode) return null;
    v.clustering = mode;
    return { id, what: "clustering", by };
  }

  /** Pins, folds, hidden levels and notes, dropped and written by `who` where it is known (a pin
   *  dropped without is recorded with no author, a note written without has none); arranging a view
   *  keeps it. The note operations are stamped in place with who and when, so that what is sent on
   *  is what was applied. Null when nothing changed. */
  arrange(id: string, ops: ViewOp[], by: string | null, who?: Who): Change[] | string | null {
    const v = this.find(id);
    if (typeof v === "string") return v;
    const version = ops.find((o): o is Extract<ViewOp, { op: "version" }> => o.op === "version");
    if (version && version.snapshot !== null) {
      const no = versionRefused(v);
      if (no) return no;
    }
    const items = ops.filter((o): o is ItemOp => o.op === "item");
    if (items.length) {
      const no = itemsRefused(v, items, (id) => this.notes.some((n) => n.id === id));
      if (no) return no;
    }
    const at = new Date().toISOString();
    for (const o of ops) if (isNoteOp(o)) stampNoteOp(o, who, at);
    const was = v.version ?? null;
    if (!applyViewOps(v, ops)) return null;
    // the build it shows changed: the list says it (each tab's clock), the timeline records it
    const kept: Change[] = (v.version ?? null) !== was ? [{ id, what: "version", by, snapshot: v.version ?? null }] : [];
    let authors = this.authors.get(id);
    for (const o of ops) {
      if (o.op !== "pin" && o.op !== "unpin" && o.op !== "clear") continue;
      if (o.op === "clear") {
        this.authors.delete(id);
        authors = undefined;
        continue;
      }
      if (!authors) this.authors.set(id, (authors = noAuthors()));
      const set = o.kind === "node" ? authors[o.mode].nodes : authors[o.mode].clusters;
      if (o.op === "pin" && who) set[o.key] = { by: who.by, ...marksOf(who), at };
      else delete set[o.key];
    }
    return v.kept ? kept : [this.keep(v, by), ...kept];
  }

  /** Who dropped a pin of view `id`, or null when that is not known (or there is no pin). */
  authorOf(id: string, mode: ClusterMode, kind: "node" | "cluster", key: string): PinAuthor | null {
    const set = this.authors.get(id)?.[mode]?.[kind === "node" ? "nodes" : "clusters"];
    return set && Object.hasOwn(set, key) ? set[key] : null;
  }

  private forget(id: string): void {
    this.views.delete(id);
    this.memory.delete(id);
    this.authors.delete(id);
    this.seenAt.delete(id);
  }

  /** View `v` saved for everyone. Its links are kept with it: a target linked to it by a click,
   *  while nobody kept it (`openTarget`), has a view of its own now. */
  private keep(v: ViewData, by: string | null): Change {
    v.kept = true;
    this.seenAt.delete(v.id);
    return { id: v.id, what: "kept", by };
  }

  /** Lay a board out afresh: its pins go (in both ways of clustering) and its layout's memory with
   *  them; its folds and hidden levels stay. */
  relayout(id: string, by: string | null): Change | string {
    const v = this.find(id);
    if (typeof v === "string") return v;
    v.pins = emptyLayouts();
    this.memory.delete(id);
    this.authors.delete(id);
    return { id, what: "relayout", by };
  }

  memoryOf(id: string, mode: ClusterMode): BoardMemory | null {
    return this.memory.get(id)?.[mode] ?? null;
  }

  /** A page laid the board out for a set the memory was not made for, starting from the memory it
   *  had (`base`, the set that memory was made for, or null): the new memory is taken when nobody
   *  handed another over since. `current` is what the memory is after. */
  setMemory(id: string, mode: ClusterMode, base: string | null, next: BoardMemory): { accepted: boolean; current: BoardMemory | null } | string {
    const v = this.find(id);
    if (typeof v === "string") return v;
    const now = this.memoryOf(id, mode);
    if ((now?.set ?? null) !== base) return { accepted: false, current: now };
    const m = this.memory.get(id) ?? {};
    m[mode] = next;
    this.memory.set(id, m);
    return { accepted: true, current: next };
  }

  /** A target's view linked to another target's name: the target was moved (HistorySpec.md), and its
   *  view goes with it, its focus too, the view's other targets staying; the view keeps its id, so
   *  that a link to it keeps working. Its scope names the new name already (server/views.ts,
   *  `moveDeclaration`), as every view's does. A target with no view has none under its new name
   *  either, and one linked to a view nobody keeps keeps that link. */
  retarget(from: string, to: string, by: string | null): Change[] {
    const v = this.viewOf(from);
    if (!v || this.viewOf(to)) return [];
    v.targets = v.targets!.map((t) => (t === from ? to : t));
    if (v.focus === from) v.focus = to;
    return [{ id: v.id, what: "linked", by, target: to }];
  }

  /** The links as the review's targets say (ViewSpec decision 29): no view linked to what is no
   *  target, and a target that a move brought from another name (`formerly`, its names before, oldest
   *  first) takes over that name's view where it has none and that name is no target now. A target
   *  unmarked is unlinked alone: its view stays, its scope, arrangement, focus and other targets as
   *  they were. Marking a target makes no view and links none (the owner's decision of 2026-10-12):
   *  it has none until a click on it gives it a temporary one (`openTarget`), or someone links it. */
  syncTargets(targets: string[], formerly: (target: string) => string[] | undefined = () => undefined): Change[] {
    const out: Change[] = [];
    const want = new Set(targets);
    for (const t of targets) {
      if (this.viewOf(t)) continue;
      const from = [...(formerly(t) ?? [])].reverse().find((w) => !want.has(w) && this.viewOf(w));
      if (from) out.push(...this.retarget(from, t, null));
    }
    for (const v of [...this.views.values()])
      for (const t of v.targets ?? [])
        if (!want.has(t)) {
          this.drop(v, t);
          out.push({ id: v.id, what: "unlinked", by: null, target: t });
        }
    return out;
  }

  /** The views pages have open now (presence says which: each page's tabs). */
  seen(ids: Iterable<string>, now = Date.now()): void {
    for (const id of ids) if (this.views.get(id)?.kept === false) this.seenAt.set(id, now);
  }

  /** Views nobody keeps and no page has had open for `grace` ms go, and the links of targets to them
   *  with them: those targets have no view again (`openTarget`). */
  sweep(now = Date.now(), grace = 8000): Change[] {
    const out: Change[] = [];
    for (const v of [...this.views.values()]) {
      if (v.kept || now - (this.seenAt.get(v.id) ?? 0) < grace) continue;
      this.forget(v.id);
      out.push({ id: v.id, what: "gone", by: null, ...(v.targets?.length ? { targets: [...v.targets] } : {}) });
    }
    return out;
  }
}
